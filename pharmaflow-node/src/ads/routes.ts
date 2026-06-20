import type { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from 'fastify';
import { upsertToken } from './repository';
import { adsService } from './service';
import { verificarTokenMeta } from '../meta/client';

type Middleware = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

interface AdsRouteOptions extends FastifyPluginOptions {
  autenticar:  Middleware;
  apenasAdmin: Middleware;
}

export async function adsRoutes(
  app:  FastifyInstance,
  opts: AdsRouteOptions,
): Promise<void> {
  const { autenticar, apenasAdmin } = opts;

  /**
   * POST /api/ads/chat
   * Envia uma mensagem para o bot de criação de campanhas via frontend.
   * Body: { texto: string; imagem_base64?: string }
   * Response: { resposta: string }
   */
  app.post<{
    Body: { texto: string; imagem_base64?: string };
  }>(
    '/api/ads/chat',
    { preHandler: [autenticar] },
    async (req, reply) => {
      const { texto, imagem_base64 } = req.body;
      const gestorId = req.user.id;

      const resposta = await adsService.processarMensagemWeb(gestorId, texto ?? '', imagem_base64);
      return reply.send({ resposta });
    },
  );

  /**
   * GET /api/ads/campanhas
   * Lista todas as campanhas das farmácias do gestor logado.
   */
  app.get(
    '/api/ads/campanhas',
    { preHandler: [autenticar] },
    async (req, reply) => {
      const campanhas = await adsService.getCampanhasDoGestor(req.user.id);
      return reply.send(campanhas);
    },
  );

  /**
   * POST /api/ads/tokens
   * Admin cadastra/atualiza o token Meta de uma farmácia.
   * Body: { farmacia_id, access_token, ad_account_id, page_id }
   */
  /**
   * GET /api/ads/token-status
   * Verifica se o META_ACCESS_TOKEN está válido e quantos dias restam.
   * Exibir no painel de configurações para alertar quando estiver perto de expirar.
   */
  app.get(
    '/api/ads/token-status',
    { preHandler: [autenticar, apenasAdmin] },
    async (_req, reply) => {
      const token = process.env.META_ACCESS_TOKEN ?? '';
      if (!token) {
        return reply.send({ configurado: false, valido: false, diasRestantes: null, expiraEm: null });
      }
      const status = await verificarTokenMeta(token);
      return reply.send({ configurado: true, ...status });
    },
  );

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
    { preHandler: [autenticar, apenasAdmin] },
    async (req, reply) => {
      const { farmacia_id, ad_account_id, page_id } = req.body;
      await upsertToken({
        farmaciaId:  farmacia_id,
        adAccountId: ad_account_id,
        pageId:      page_id,
      });
      return reply.send({ ok: true });
    },
  );
}
