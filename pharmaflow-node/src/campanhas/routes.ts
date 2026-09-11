import type { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from 'fastify';
import {
  publicarCampanha, publicarNovosAnuncios,
  type PublicarCampanhaInput, type NovosAnunciosInput,
} from './service';
import { listarConjuntosDaConta, duplicarConjunto } from '../meta/gerenciador';
import { logger } from '../logger';

/** Normaliza "123" ou "act_123" para o formato que a Graph API espera. */
const normalizarConta = (id: string): string => (id.startsWith('act_') ? id : `act_${id}`);

/** Faixa de orçamento diário permitida, em centavos. Mínimo do Meta, teto da agência. */
const ORCAMENTO_MINIMO_CENTAVOS = 500;    // R$ 5,00
const ORCAMENTO_MAXIMO_CENTAVOS = 5000;   // R$ 50,00

/**
 * Valida o orçamento diário do corpo da requisição.
 * Retorna a mensagem de erro, ou null quando está dentro da faixa.
 * O frontend já bloqueia o botão, mas a regra tem que valer para qualquer
 * cliente da API — inclusive chamada direta.
 */
function erroOrcamento(centavos: unknown): string | null {
  if (typeof centavos !== 'number' || !Number.isFinite(centavos) || centavos <= 0) {
    return 'Orçamento diário não informado.';
  }
  if (centavos < ORCAMENTO_MINIMO_CENTAVOS) return 'Orçamento diário mínimo é R$ 5,00.';
  if (centavos > ORCAMENTO_MAXIMO_CENTAVOS) return 'Orçamento diário máximo é R$ 50,00.';
  return null;
}

/** Erro do Meta → resposta HTTP. 502 (não 401) para não deslogar o gestor. */
function responderErroMeta(reply: FastifyReply, err: unknown, contexto: string) {
  const msg = (err as Error).message;
  logger.error({ err: msg }, contexto);
  if (msg === 'META_TOKEN_EXPIRADO') {
    return reply.code(502).send({ detail: 'Token do Meta expirado ou inválido. Gere um novo e atualize o servidor.' });
  }
  return reply.code(502).send({ detail: `${contexto}: ${msg}` });
}

type Middleware = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

interface CampanhasRouteOptions extends FastifyPluginOptions {
  autenticar:  Middleware;
  apenasAdmin: Middleware;
}

export async function campanhasRoutes(
  app:  FastifyInstance,
  opts: CampanhasRouteOptions,
): Promise<void> {
  const { autenticar } = opts;

  /**
   * POST /api/campanhas/criar
   * Recebe o JSON do wizard (+ PNGs dos criativos) e cria a campanha ATIVA no Meta.
   * A IA só é chamada 1x, e apenas se a copy não veio preenchida.
   */
  app.post<{ Body: PublicarCampanhaInput }>(
    '/api/campanhas/criar',
    // Limite alto: a campanha sobe N criativos de uma vez, cada PNG 1080×1350
    // em base64 pesa ~1 MB. 6 a 10 criativos é o uso normal.
    { preHandler: [autenticar], bodyLimit: 80 * 1024 * 1024 },
    async (req, reply) => {
      const body = req.body;
      if (!body?.conta?.id)        return reply.code(400).send({ detail: 'Conta de anúncios não informada.' });
      if (!body?.objetivo?.codigo) return reply.code(400).send({ detail: 'Objetivo não informado.' });
      const erroOrc = erroOrcamento(body?.orcamento?.diarioCentavos);
      if (erroOrc) {
        logger.warn({ conta: body?.conta?.id, centavos: body?.orcamento?.diarioCentavos }, erroOrc);
        return reply.code(400).send({ detail: erroOrc });
      }

      try {
        const r = await publicarCampanha(body);
        logger.info({ campanhaId: r.campanhaId, conta: body.conta.id }, 'Campanha criada via wizard');
        return reply.code(201).send(r);
      } catch (err) {
        const msg = (err as Error).message;
        logger.error({ err: msg }, 'Falha ao publicar campanha');
        // 502 (não 401): problema é o token do META, não a sessão do usuário.
        // 401 faria o frontend deslogar o gestor indevidamente.
        if (msg === 'META_TOKEN_EXPIRADO') {
          return reply.code(502).send({ detail: 'Token do Meta expirado ou inválido. Gere um novo e atualize o servidor.' });
        }
        return reply.code(502).send({ detail: `Erro ao criar campanha no Meta: ${msg}` });
      }
    },
  );

  /**
   * POST /api/campanhas/conjuntos/:conjuntoId/novos-anuncios
   * Parte de um conjunto que já roda: cria uma CÓPIA dele com as configurações
   * revisadas pelo gestor e sobe os criativos novos dentro. O original fica
   * intacto, para não perder o aprendizado do Meta.
   */
  app.post<{ Params: { conjuntoId: string }; Body: Omit<NovosAnunciosInput, 'conjuntoId'> }>(
    '/api/campanhas/conjuntos/:conjuntoId/novos-anuncios',
    { preHandler: [autenticar], bodyLimit: 80 * 1024 * 1024 },
    async (req, reply) => {
      const body = req.body;
      if (!body?.conta?.id) return reply.code(400).send({ detail: 'Conta de anúncios não informada.' });
      const erroOrc = erroOrcamento(body?.orcamento?.diarioCentavos);
      if (erroOrc) {
        logger.warn({ conta: body?.conta?.id, centavos: body?.orcamento?.diarioCentavos }, erroOrc);
        return reply.code(400).send({ detail: erroOrc });
      }
      if (!body?.criativos?.itens?.length) {
        return reply.code(400).send({ detail: 'Nenhum criativo foi enviado.' });
      }

      try {
        const r = await publicarNovosAnuncios({ ...body, conjuntoId: req.params.conjuntoId });
        logger.info({ conjuntoId: r.conjuntoId, anuncios: r.anuncioIds.length }, 'Novos anúncios publicados');
        return reply.code(201).send(r);
      } catch (err) {
        return responderErroMeta(reply, err, 'Erro ao subir os novos anúncios');
      }
    },
  );

  // ── Gerenciador: leitura ao vivo + duplicação de conjunto ───────────────────

  const tokenMeta = (): string => {
    const t = process.env.META_ACCESS_TOKEN ?? '';
    if (!t) throw new Error('META_ACCESS_TOKEN não configurado no servidor.');
    return t;
  };

  /** GET /api/campanhas/conjuntos?conta=act_123 — todos os ad sets da conta. */
  app.get<{ Querystring: { conta?: string } }>(
    '/api/campanhas/conjuntos',
    { preHandler: [autenticar] },
    async (req, reply) => {
      const conta = req.query.conta;
      if (!conta) return reply.code(400).send({ detail: 'Conta de anúncios não informada.' });
      try {
        return reply.send({ conjuntos: await listarConjuntosDaConta(tokenMeta(), normalizarConta(conta)) });
      } catch (err) {
        return responderErroMeta(reply, err, 'Erro ao listar conjuntos');
      }
    },
  );

  /**
   * POST /api/campanhas/conjuntos/:conjuntoId/duplicar
   * Duplica o conjunto N vezes via endpoint nativo do Meta (/copies).
   * Padrão: leva os anúncios junto e nasce PAUSADO, para o gestor revisar
   * antes de começar a gastar.
   */
  app.post<{
    Params: { conjuntoId: string };
    Body: { quantidade?: number; comAnuncios?: boolean; ativar?: boolean; campanhaDestinoId?: string };
  }>(
    '/api/campanhas/conjuntos/:conjuntoId/duplicar',
    { preHandler: [autenticar] },
    async (req, reply) => {
      const { conjuntoId } = req.params;
      const body = req.body ?? {};
      const quantidade = Math.min(Math.max(Number(body.quantidade ?? 1), 1), 5);
      const comAnuncios = body.comAnuncios !== false;   // padrão: true

      const criados: Array<{ conjuntoId: string; anunciosCopiados: number }> = [];
      const avisos: string[] = [];

      try {
        const token = tokenMeta();
        for (let i = 1; i <= quantidade; i++) {
          // Uma cópia que falha não deve descartar as que já deram certo.
          try {
            criados.push(await duplicarConjunto(token, conjuntoId, {
              comAnuncios,
              status:            body.ativar ? 'ACTIVE' : 'PAUSED',
              campanhaDestinoId: body.campanhaDestinoId,
              sufixo:            quantidade > 1 ? ` — Cópia ${i}` : ' — Cópia',
            }));
          } catch (err) {
            const msg = (err as Error).message;
            if (msg === 'META_TOKEN_EXPIRADO') throw err;   // não adianta insistir
            logger.warn({ err: msg, conjuntoId, copia: i }, 'Falha ao duplicar conjunto');
            avisos.push(`Cópia ${i} falhou: ${msg}`);
          }
        }
      } catch (err) {
        return responderErroMeta(reply, err, 'Erro ao duplicar conjunto');
      }

      if (!criados.length) {
        return reply.code(502).send({ detail: avisos[0] ?? 'Nenhuma cópia pôde ser criada.' });
      }

      logger.info({ conjuntoId, criados: criados.length }, 'Conjunto duplicado');
      return reply.code(201).send({ criados, avisos });
    },
  );
}
