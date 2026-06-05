import type { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from 'fastify';
import * as controller from './controller';

type Middleware = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

interface WhatsAppRouteOptions extends FastifyPluginOptions {
  autenticar:  Middleware;
  apenasAdmin: Middleware;
}

/**
 * Plugin Fastify com todas as rotas do módulo WhatsApp.
 * Registre em api/index.ts com:
 *   app.register(whatsappRoutes, { autenticar, apenasAdmin });
 */
export async function whatsappRoutes(
  app:  FastifyInstance,
  opts: WhatsAppRouteOptions,
): Promise<void> {
  const { autenticar, apenasAdmin } = opts;

  /**
   * GET /api/whatsapp/status
   * Retorna o estado atual da conexão WhatsApp.
   * Resposta: { conectado, status, instancia, numero, configurado }
   */
  app.get('/api/whatsapp/status',
    { preHandler: [autenticar] },
    controller.getStatus,
  );

  /**
   * POST /api/whatsapp/connect
   * Cria (ou reconecta) a instância e devolve o QR code em base64.
   * Body: { instance_name: string }
   * Resposta: { instancia, status: "connecting", qr_code: "data:image/png;base64,..." }
   */
  app.post('/api/whatsapp/connect',
    { preHandler: [autenticar, apenasAdmin] },
    controller.conectar,
  );

  /**
   * GET /api/whatsapp/qrcode
   * Polling do frontend para verificar se o QR foi escaneado.
   * Quando status = "open" o QR é nulo — mostra tela de sucesso.
   * Resposta: { status, qr_code, instancia }
   */
  app.get('/api/whatsapp/qrcode',
    { preHandler: [autenticar] },
    controller.getQrCode,
  );

  /**
   * DELETE /api/whatsapp/disconnect
   * Faz logout do WhatsApp (mantém a instância, apenas desconecta o número).
   */
  app.delete('/api/whatsapp/disconnect',
    { preHandler: [autenticar, apenasAdmin] },
    controller.desconectar,
  );

  /**
   * DELETE /api/whatsapp/instance
   * Remove completamente a instância da Evolution API e do banco.
   */
  app.delete('/api/whatsapp/instance',
    { preHandler: [autenticar, apenasAdmin] },
    controller.deletarInstancia,
  );

  /**
   * POST /api/whatsapp/webhook
   * Recebe eventos em tempo real da Evolution API (sem autenticação JWT,
   * protegido pelo header x-webhook-secret ou query ?secret=).
   * Eventos suportados: connection.update, qrcode.updated
   */
  app.post('/api/whatsapp/webhook', controller.webhook);
}
