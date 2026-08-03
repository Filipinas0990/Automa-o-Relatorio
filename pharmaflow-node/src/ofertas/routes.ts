import type { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from 'fastify';
import { ofertasRepository } from './repository';
import { ofertasService } from './service';
import { listarProdutos, getImagem } from '../catalogo/repository';
import { logger } from '../logger';

type Middleware = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

interface OfertasRouteOptions extends FastifyPluginOptions {
  autenticar:  Middleware;
  apenasAdmin: Middleware;
}

interface EnviarOfertaBody {
  farmacia_id:      number;
  produtos:         number[];
  produtos_livres?: string | null;
  observacao?:      string | null;
  enviado_por?:     string | null;
}

/**
 * Ofertas enviadas pelo dono da farmácia.
 *
 * As rotas sob /api/publico/ NÃO exigem JWT — o token do link é a credencial
 * (mesmo princípio do webhook da Evolution). Tudo que elas devolvem é derivado
 * do token, então um link só alcança as farmácias do gestor que o gerou.
 */
export async function ofertasRoutes(
  app:  FastifyInstance,
  opts: OfertasRouteOptions,
): Promise<void> {
  const { autenticar } = opts;

  // ── Públicas (o dono da farmácia, sem login) ───────────────────────────────

  /**
   * GET /api/publico/ofertas/:token
   * Abre o link: quem é o gestor, quais farmácias ele atende e o catálogo.
   */
  app.get<{ Params: { token: string } }>(
    '/api/publico/ofertas/:token',
    async (req, reply) => {
      const gestor = await ofertasRepository.gestorPorToken(req.params.token);
      // 404 genérico: não revela se o token existe mas está inativo
      if (!gestor) return reply.code(404).send({ detail: 'Link inválido ou expirado.' });

      const [lista, produtos] = await Promise.all([
        ofertasRepository.farmaciasDoGestor(gestor.id, gestor.isAdmin),
        listarProdutos(),
      ]);

      return reply.send({
        gestor:    { nome: gestor.nome },
        farmacias: lista.map((f) => ({ id: f.id, nome: f.nome, cidade: f.cidade })),
        // só produtos ativos são oferecidos ao dono da farmácia
        produtos:  produtos.filter((p) => p.ativo).map((p) => ({ id: p.id, nome: p.nome })),
      });
    },
  );

  /**
   * GET /api/publico/ofertas/:token/produto/:id/imagem
   * Foto do produto — o dono precisa ver o que está escolhendo.
   */
  app.get<{ Params: { token: string; id: string } }>(
    '/api/publico/ofertas/:token/produto/:id/imagem',
    async (req, reply) => {
      const gestor = await ofertasRepository.gestorPorToken(req.params.token);
      if (!gestor) return reply.code(404).send({ detail: 'Link inválido ou expirado.' });

      const img = await getImagem(parseInt(req.params.id, 10));
      if (!img?.imagemB64) return reply.code(404).send({ detail: 'Sem imagem' });

      return reply
        .header('Content-Type', img.mime || 'image/png')
        .header('Cache-Control', 'public, max-age=86400')
        .send(Buffer.from(img.imagemB64, 'base64'));
    },
  );

  /**
   * POST /api/publico/ofertas/:token
   * O dono envia a seleção. A farmácia precisa ser do gestor daquele token —
   * senão um link permitiria enviar em nome de cliente de outro gestor.
   */
  app.post<{ Params: { token: string }; Body: EnviarOfertaBody }>(
    '/api/publico/ofertas/:token',
    async (req, reply) => {
      const gestor = await ofertasRepository.gestorPorToken(req.params.token);
      if (!gestor) return reply.code(404).send({ detail: 'Link inválido ou expirado.' });

      const b = req.body;
      const farmaciaId = Number(b?.farmacia_id);
      if (!Number.isFinite(farmaciaId)) {
        return reply.code(400).send({ detail: 'Escolha a sua farmácia.' });
      }

      const doGestor = await ofertasRepository.farmaciasDoGestor(gestor.id, gestor.isAdmin);
      if (!doGestor.some((f) => f.id === farmaciaId)) {
        return reply.code(403).send({ detail: 'Esta farmácia não está disponível neste link.' });
      }

      const ids = Array.isArray(b.produtos) ? b.produtos.map(Number).filter(Number.isFinite) : [];
      const livres = b.produtos_livres?.trim() || null;

      if (ids.length === 0 && !livres) {
        return reply.code(400).send({ detail: 'Escolha ao menos um produto.' });
      }

      // Guarda o nome junto do id: o catálogo pode mudar depois do envio
      const catalogo = await listarProdutos();
      const porId = new Map(catalogo.map((p) => [p.id, p.nome]));
      const produtos = ids
        .filter((id) => porId.has(id))
        .map((id) => ({ id, nome: porId.get(id) as string }));

      const solicitacao = await ofertasRepository.criarSolicitacao({
        gestorId:       gestor.id,
        farmaciaId,
        produtosJson:   JSON.stringify(produtos),
        produtosLivres: livres,
        observacao:     b.observacao?.trim() || null,
        enviadoPor:     b.enviado_por?.trim() || null,
      });

      logger.info(
        { solicitacaoId: solicitacao.id, gestorId: gestor.id, farmaciaId, total: produtos.length },
        'Nova solicitação de oferta recebida pelo link público',
      );

      return reply.code(201).send({ ok: true, id: solicitacao.id });
    },
  );

  // ── Do gestor (JWT) ────────────────────────────────────────────────────────

  /** GET /api/ofertas/link — link do gestor (cria na primeira chamada). */
  app.get('/api/ofertas/link', { preHandler: [autenticar] }, async (req, reply) => {
    const link = await ofertasService.obterOuCriarLink(req.user.id);
    return reply.send(link);
  });

  /** POST /api/ofertas/link/regenerar — invalida o link antigo. */
  app.post('/api/ofertas/link/regenerar', { preHandler: [autenticar] }, async (req, reply) => {
    const link = await ofertasService.regenerarLink(req.user.id);
    return reply.send(link);
  });

  /** GET /api/ofertas/solicitacoes — o que os clientes enviaram. */
  app.get('/api/ofertas/solicitacoes', { preHandler: [autenticar] }, async (req, reply) => {
    const lista = await ofertasRepository.listarSolicitacoes(req.user.id);

    return reply.send(
      lista.map((s) => {
        let produtos: { id: number; nome: string }[] = [];
        try { produtos = JSON.parse(s.produtosJson); } catch { /* ignore */ }
        return {
          id:              s.id,
          farmacia_id:     s.farmaciaId,
          farmacia:        s.farmacia,
          produtos,
          produtos_livres: s.produtosLivres,
          observacao:      s.observacao,
          enviado_por:     s.enviadoPor,
          status:          s.status,
          criado_em:       s.criadoEm,
          atendida_em:     s.atendidaEm,
        };
      }),
    );
  });

  /**
   * GET /api/ofertas/carteira
   * Todas as farmácias do gestor com o estado de resposta de cada uma.
   * Alimenta o painel de acompanhamento (passo 2 do disparo).
   */
  app.get('/api/ofertas/carteira', { preHandler: [autenticar] }, async (req, reply) => {
    // Admin vê todas — senão o pedido que chegou pelo link dele ficaria órfão,
    // sem a farmácia correspondente na carteira.
    const carteira = await ofertasRepository.carteiraDoGestor(req.user.id, req.user.isAdmin);

    return reply.send(
      carteira.map(({ farmacia, pendente, ultimoEnvioEm }) => {
        let produtos: { id: number; nome: string }[] = [];
        if (pendente) {
          try { produtos = JSON.parse(pendente.produtosJson); } catch { /* ignore */ }
        }

        return {
          farmacia_id:  farmacia.id,
          farmacia:     farmacia.nome,
          cidade:       farmacia.cidade,
          telefone:     farmacia.telefone,
          responsavel:  farmacia.responsavel,
          // "respondeu" = tem pedido aguardando virar disparo
          respondeu:    Boolean(pendente),
          solicitacao:  pendente ? {
            id:              pendente.id,
            produtos,
            produtos_livres: pendente.produtosLivres,
            observacao:      pendente.observacao,
            enviado_por:     pendente.enviadoPor,
            criado_em:       pendente.criadoEm,
          } : null,
          ultimo_envio_em: ultimoEnvioEm,
        };
      }),
    );
  });

  /** PATCH /api/ofertas/solicitacoes/:id — muda o status. */
  app.patch<{ Params: { id: string }; Body: { status: string } }>(
    '/api/ofertas/solicitacoes/:id',
    { preHandler: [autenticar] },
    async (req, reply) => {
      const solicitacao = await ofertasRepository.getSolicitacao(parseInt(req.params.id, 10));
      if (!solicitacao) return reply.code(404).send({ detail: 'Solicitação não encontrada' });
      if (solicitacao.gestorId !== req.user.id) {
        return reply.code(403).send({ detail: 'Esta solicitação não pertence a você' });
      }

      const status = req.body?.status;
      if (!['pendente', 'atendida', 'descartada'].includes(status)) {
        return reply.code(400).send({ detail: 'Status inválido' });
      }

      await ofertasRepository.atualizarStatus(solicitacao.id, status);
      return reply.send({ ok: true });
    },
  );

  /** GET /api/ofertas/pendentes — total para o badge do menu. */
  app.get('/api/ofertas/pendentes', { preHandler: [autenticar] }, async (req, reply) => {
    const total = await ofertasRepository.contarPendentes(req.user.id);
    return reply.send({ total });
  });
}
