import type { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from 'fastify';
import { publicarCampanha, type PublicarCampanhaInput } from './service';
import { logger } from '../logger';

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
    { preHandler: [autenticar], bodyLimit: 30 * 1024 * 1024 },
    async (req, reply) => {
      const body = req.body;
      if (!body?.conta?.id)        return reply.code(400).send({ detail: 'Conta de anúncios não informada.' });
      if (!body?.objetivo?.codigo) return reply.code(400).send({ detail: 'Objetivo não informado.' });
      if (!body?.orcamento?.diarioCentavos || body.orcamento.diarioCentavos < 500) {
        return reply.code(400).send({ detail: 'Orçamento diário mínimo é R$ 5,00.' });
      }

      try {
        const r = await publicarCampanha(body);
        logger.info({ campanhaId: r.campanhaId, conta: body.conta.id }, 'Campanha criada via wizard');
        return reply.code(201).send(r);
      } catch (err) {
        const msg = (err as Error).message;
        logger.error({ err: msg }, 'Falha ao publicar campanha');
        if (msg === 'META_TOKEN_EXPIRADO') {
          return reply.code(401).send({ detail: 'Token Meta expirado. Gere um novo e atualize o servidor.' });
        }
        return reply.code(502).send({ detail: `Erro ao criar campanha no Meta: ${msg}` });
      }
    },
  );
}
