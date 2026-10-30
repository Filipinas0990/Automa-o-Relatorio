import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Controller } from '../compartilhado/Controller';
import { RequisicaoInvalida, NaoEncontrado, Indisponivel, NaoAutorizado } from '../compartilhado/erros';
import { logger } from '../logger';
import type { Autenticador } from '../auth/Autenticador';
import type { WhatsappService } from './WhatsappService';

/**
 * Instância alvo da operação, aceita tanto em `?instance=` quanto no corpo.
 * Ausente = a conexão default (compatibilidade com os clientes antigos, de
 * quando o sistema só tinha uma).
 */
function instanciaAlvo(request: FastifyRequest): string | undefined {
  const query = request.query as Record<string, string | undefined> | null;
  const body  = request.body  as { instance_name?: string; instance?: string } | null;
  const bruto = query?.instance ?? body?.instance ?? body?.instance_name;
  return bruto?.trim() || undefined;
}

/** Rotas HTTP de /api/whatsapp — conexões globais (Evolution API) e o webhook delas. */
export class WhatsappController extends Controller {
  constructor(
    private readonly service: WhatsappService,
    private readonly auth: Autenticador,
  ) {
    super();
  }

  protected rotas(app: FastifyInstance): void {
    const { autenticar, apenasAdmin } = this.auth;
    const comAuth = { preHandler: autenticar };
    const soAdmin = { preHandler: [autenticar, apenasAdmin] };

    /**
     * GET /api/whatsapp/conexoes
     * Lista TODAS as conexões cadastradas, cada uma com o status conferido na
     * Evolution. É o que alimenta a tela "Conexões".
     */
    app.get('/api/whatsapp/conexoes', comAuth, async () => {
      return this.service.listarConexoes();
    });

    /**
     * GET /api/whatsapp/status
     * Resumo "tem WhatsApp de pé?" — prioriza uma conexão conectada.
     */
    app.get('/api/whatsapp/status', comAuth, async () => {
      return this.service.getStatus();
    });

    /**
     * POST /api/whatsapp/connect
     * Cria (ou reconecta) UMA instância e devolve o QR code em base64.
     * Body: { instance_name: string, nome?: string }
     */
    app.post('/api/whatsapp/connect', soAdmin, async (request) => {
      const body = request.body as { instance_name?: string; nome?: string } | null;
      const instanceName = body?.instance_name?.trim();

      if (!instanceName) {
        throw new RequisicaoInvalida('Campo "instance_name" é obrigatório.');
      }
      // A instância vira parte da URL da Evolution e é a chave única no banco.
      if (!/^[a-zA-Z0-9._-]{2,100}$/.test(instanceName)) {
        throw new RequisicaoInvalida(
          'Nome da instância inválido. Use de 2 a 100 caracteres entre letras, números, ponto, hífen e underscore.',
        );
      }
      if (!process.env.EVOLUTION_API_URL || !process.env.EVOLUTION_API_KEY) {
        throw new Indisponivel('Evolution API não configurada no servidor. Defina EVOLUTION_API_URL e EVOLUTION_API_KEY.');
      }

      return this.service.conectar(instanceName, body?.nome ?? null);
    });

    /**
     * GET /api/whatsapp/qrcode?instance=<nome>
     * Polling do frontend para verificar se o QR daquela conexão foi escaneado.
     */
    app.get('/api/whatsapp/qrcode', comAuth, async (request) => {
      const resultado = await this.service.getQrCode(instanciaAlvo(request));
      if (!resultado) {
        throw new NaoEncontrado('Nenhuma instância configurada. Chame POST /api/whatsapp/connect primeiro.');
      }
      return resultado;
    });

    /** DELETE /api/whatsapp/disconnect?instance=<nome> — logout de UMA conexão. */
    app.delete('/api/whatsapp/disconnect', soAdmin, async (request) => {
      const ok = await this.service.desconectar(instanciaAlvo(request));
      if (!ok) throw new NaoEncontrado('Conexão não encontrada.');
      return { mensagem: 'WhatsApp desconectado com sucesso.' };
    });

    /** DELETE /api/whatsapp/instance?instance=<nome> — remove UMA conexão por completo. */
    app.delete('/api/whatsapp/instance', soAdmin, async (request) => {
      const ok = await this.service.deletarInstancia(instanciaAlvo(request));
      if (!ok) throw new NaoEncontrado('Conexão não encontrada.');
      return { mensagem: 'Instância removida completamente.' };
    });

    /**
     * POST /api/whatsapp/webhook
     * Recebe eventos em tempo real da Evolution API (sem autenticação JWT,
     * protegido pelo header x-webhook-secret ou query ?secret=).
     */
    app.post('/api/whatsapp/webhook', async (request) => {
      const segredo = process.env.EVOLUTION_WEBHOOK_SECRET || '';
      const segredoRecebido =
        (request.headers['x-webhook-secret'] as string | undefined) ??
        (request.query as Record<string, string>)['secret'] ??
        '';

      if (segredo && segredoRecebido !== segredo) {
        throw new NaoAutorizado('Webhook não autorizado.');
      }

      const body = request.body as { event?: string; data?: unknown; instance?: string } | null;
      if (body?.event) {
        // `instance` diz de qual conexão é o evento — sem isso, com várias
        // conexões, o status de uma sobrescreveria o da outra.
        await this.service.processarWebhook(body.event, body.data, body.instance).catch((err) =>
          logger.error({ err }, 'Erro ao processar webhook WhatsApp'),
        );
      }

      return { ok: true };
    });
  }
}
