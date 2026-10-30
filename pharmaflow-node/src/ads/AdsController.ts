import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Controller } from '../compartilhado/Controller';
import { RequisicaoInvalida, FalhaExterna } from '../compartilhado/erros';
import { verificarTokenMeta, buscarLocalizacoes, listarContasDeAnuncio } from '../meta/client';
import { tokenMetaDo, msgTokenExpirado, type TokenMeta } from '../meta/tokenGestor';
import type { Autenticador } from '../auth/Autenticador';
import type { AdsService } from './AdsService';
import type { TokenMetaRepository } from './TokenMetaRepository';
import type { GeocodificadorCidade } from './GeocodificadorCidade';

/** Token do gestor logado (Facebook conectado) ou o geral do servidor. Lança RequisicaoInvalida se nenhum existir. */
function tokenMeta(req: FastifyRequest): TokenMeta {
  try {
    return tokenMetaDo(req.user);
  } catch (e) {
    throw new RequisicaoInvalida((e as Error).message);
  }
}

/** Mapeia um erro do Meta para FalhaExterna, com a mensagem certa quando é token expirado. */
function erroMeta(err: unknown, contexto: string, proprio: boolean): FalhaExterna {
  const msg = (err as Error).message;
  if (msg === 'META_TOKEN_EXPIRADO') return new FalhaExterna(msgTokenExpirado(proprio));
  return new FalhaExterna(`${contexto}: ${msg}`);
}

/** Rotas HTTP de /api/ads — bot de criação de campanhas (WhatsApp/Web) e configuração Meta por cliente. */
export class AdsController extends Controller {
  constructor(
    private readonly service:        AdsService,
    private readonly tokens:         TokenMetaRepository,
    private readonly geocodificador: GeocodificadorCidade,
    private readonly auth:           Autenticador,
  ) {
    super();
  }

  protected rotas(app: FastifyInstance): void {
    const { autenticar, apenasAdmin } = this.auth;
    const comAuth = { preHandler: autenticar };
    const soAdmin = { preHandler: [autenticar, apenasAdmin] };

    /**
     * POST /api/ads/chat
     * Envia uma mensagem para o bot de criação de campanhas via frontend.
     * Body: { texto: string; imagem_base64?: string }
     */
    app.post<{ Body: { texto: string; imagem_base64?: string } }>(
      '/api/ads/chat',
      comAuth,
      async (req, reply) => {
        const { texto, imagem_base64 } = req.body;
        const resposta = await this.service.processarMensagemWeb(req.user.id, texto ?? '', imagem_base64);
        return reply.send({ resposta });
      },
    );

    /**
     * GET /api/ads/campanhas
     * Lista todas as campanhas das farmácias do gestor logado.
     */
    app.get('/api/ads/campanhas', comAuth, async (req, reply) => {
      return reply.send(await this.service.getCampanhasDoGestor(req.user.id));
    });

    /**
     * GET /api/ads/contas?refresh=1
     * Lista TODAS as contas de anúncios acessíveis pelo token Meta (System User do BM).
     * Usado na etapa 1 do wizard de campanha ("Em qual conta será subida a campanha?").
     *
     * Responde do cache (migration 0032) — a chamada à Meta é lenta demais para
     * ficar no caminho da tela. `refresh=1` é o botão "Atualizar": ignora o cache
     * e espera a Meta responder.
     */
    app.get<{ Querystring: { refresh?: string; forcar?: string } }>(
      '/api/ads/contas',
      comAuth,
      async (req, reply) => {
        const meta = tokenMeta(req);
        try {
          // Facebook do gestor: lista ao vivo só as contas que ELE acessa. O
          // cache (migration 0032) é do token geral — uma linha só, igual para todos.
          if (meta.proprio) {
            const contas = await listarContasDeAnuncio(meta.token);
            return reply.send({ contas, atualizadoEm: null, sincronizando: false, aviso: null });
          }
          const { refresh, forcar: forcarQuery } = req.query;
          const forcar =
            refresh === '1' || refresh === 'true' ||
            forcarQuery === '1' || forcarQuery === 'true';
          return reply.send(await this.service.listarContasAnuncio(meta.token, { forcar }));
        } catch (err) {
          throw erroMeta(err, 'Erro ao consultar a Meta', meta.proprio);
        }
      },
    );

    /**
     * GET /api/ads/geo-busca?q=termo
     * Autocomplete de cidades (Brasil) para a segmentação por localização do wizard.
     */
    app.get<{ Querystring: { q?: string } }>(
      '/api/ads/geo-busca',
      comAuth,
      async (req, reply) => {
        const token = tokenMeta(req).token;
        try {
          const resultados = await buscarLocalizacoes(token, req.query.q ?? '');
          return reply.send({ resultados });
        } catch (err) {
          throw new FalhaExterna(`Erro ao buscar localização na Meta: ${(err as Error).message}`);
        }
      },
    );

    /**
     * GET /api/ads/geo-coordenadas?nome=Fortaleza&regiao=Ceará
     * Centro da cidade (lat/lon) para desenhar o mapa do raio no wizard.
     * Só visual: o targeting do Meta usa a "key" da cidade, não a coordenada.
     * Responde 200 com coordenada null quando não encontra — o mapa some, a etapa segue.
     */
    app.get<{ Querystring: { nome?: string; regiao?: string } }>(
      '/api/ads/geo-coordenadas',
      comAuth,
      async (req, reply) => {
        const nome = (req.query.nome ?? '').trim();
        if (!nome) throw new RequisicaoInvalida('Cidade não informada.');
        return reply.send({ coordenada: await this.geocodificador.coordenadas(nome, req.query.regiao ?? '') });
      },
    );

    /**
     * GET /api/ads/token-status
     * Verifica se o META_ACCESS_TOKEN está válido e quantos dias restam.
     * Exibir no painel de configurações para alertar quando estiver perto de expirar.
     */
    app.get('/api/ads/token-status', soAdmin, async (_req, reply) => {
      const token = process.env.META_ACCESS_TOKEN ?? '';
      if (!token) {
        return reply.send({ configurado: false, valido: false, diasRestantes: null, expiraEm: null });
      }
      const status = await verificarTokenMeta(token);
      return reply.send({ configurado: true, ...status });
    });

    /**
     * POST /api/ads/tokens
     * Admin cadastra as configs Meta de uma farmácia (ad_account_id e page_id).
     * O access_token NÃO vem aqui — vem de META_ACCESS_TOKEN no env (perfil pessoal).
     * Body: { farmacia_id, ad_account_id, page_id }
     */
    app.post<{
      Body: {
        farmacia_id:   number;
        ad_account_id: string;
        page_id:       string;
      };
    }>(
      '/api/ads/tokens',
      soAdmin,
      async (req, reply) => {
        const { farmacia_id, ad_account_id, page_id } = req.body;
        await this.tokens.upsertToken({
          farmaciaId:  farmacia_id,
          adAccountId: ad_account_id,
          pageId:      page_id,
        });
        return reply.send({ ok: true });
      },
    );
  }
}
