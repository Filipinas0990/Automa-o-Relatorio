import type { FastifyRequest, FastifyReply } from 'fastify';
import { whatsappService } from './service';
import { logger } from '../logger';

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

// ── GET /api/whatsapp/conexoes ────────────────────────────────────────────────

export async function listarConexoes(
  _request: FastifyRequest,
  reply:    FastifyReply,
): Promise<void> {
  const resultado = await whatsappService.listarConexoes();
  reply.send(resultado);
}

// ── GET /api/whatsapp/status ──────────────────────────────────────────────────

export async function getStatus(
  _request: FastifyRequest,
  reply:    FastifyReply,
): Promise<void> {
  const status = await whatsappService.getStatus();
  reply.send(status);
}

// ── POST /api/whatsapp/connect ────────────────────────────────────────────────

export async function conectar(
  request: FastifyRequest,
  reply:   FastifyReply,
): Promise<void> {
  const body         = request.body as { instance_name?: string; nome?: string } | null;
  const instanceName = body?.instance_name?.trim();

  if (!instanceName) {
    reply.code(400).send({ detail: 'Campo "instance_name" é obrigatório.' });
    return;
  }

  // A instância vira parte da URL da Evolution e é a chave única no banco.
  if (!/^[a-zA-Z0-9._-]{2,100}$/.test(instanceName)) {
    reply.code(400).send({ detail: 'Nome da instância inválido. Use de 2 a 100 caracteres entre letras, números, ponto, hífen e underscore.' });
    return;
  }

  if (!process.env.EVOLUTION_API_URL || !process.env.EVOLUTION_API_KEY) {
    reply.code(503).send({ detail: 'Evolution API não configurada no servidor. Defina EVOLUTION_API_URL e EVOLUTION_API_KEY.' });
    return;
  }

  try {
    const resultado = await whatsappService.conectar(instanceName, body?.nome ?? null);
    reply.send(resultado);
  } catch (err) {
    logger.error({ err }, 'Erro ao iniciar conexão WhatsApp');
    reply.code(502).send({ detail: 'Não foi possível conectar à Evolution API. Verifique as credenciais.' });
  }
}

// ── GET /api/whatsapp/qrcode ──────────────────────────────────────────────────

export async function getQrCode(
  request: FastifyRequest,
  reply:   FastifyReply,
): Promise<void> {
  const resultado = await whatsappService.getQrCode(instanciaAlvo(request));
  if (!resultado) {
    reply.code(404).send({ detail: 'Nenhuma instância configurada. Chame POST /api/whatsapp/connect primeiro.' });
    return;
  }
  reply.send(resultado);
}

// ── DELETE /api/whatsapp/disconnect ──────────────────────────────────────────

export async function desconectar(
  request: FastifyRequest,
  reply:   FastifyReply,
): Promise<void> {
  const ok = await whatsappService.desconectar(instanciaAlvo(request));
  if (!ok) {
    reply.code(404).send({ detail: 'Conexão não encontrada.' });
    return;
  }
  reply.send({ mensagem: 'WhatsApp desconectado com sucesso.' });
}

// ── DELETE /api/whatsapp/instance ─────────────────────────────────────────────

export async function deletarInstancia(
  request: FastifyRequest,
  reply:   FastifyReply,
): Promise<void> {
  const ok = await whatsappService.deletarInstancia(instanciaAlvo(request));
  if (!ok) {
    reply.code(404).send({ detail: 'Conexão não encontrada.' });
    return;
  }
  reply.send({ mensagem: 'Instância removida completamente.' });
}

// ── POST /api/whatsapp/webhook ────────────────────────────────────────────────
// Recebe eventos da Evolution API (connection.update, qrcode.updated, etc.)

export async function webhook(
  request: FastifyRequest,
  reply:   FastifyReply,
): Promise<void> {
  const segredo          = process.env.EVOLUTION_WEBHOOK_SECRET || '';
  const segredoRecebido  =
    (request.headers['x-webhook-secret'] as string | undefined) ??
    (request.query as Record<string, string>)['secret'] ??
    '';

  if (segredo && segredoRecebido !== segredo) {
    reply.code(401).send({ detail: 'Webhook não autorizado.' });
    return;
  }

  const body = request.body as { event?: string; data?: unknown; instance?: string } | null;
  if (body?.event) {
    // `instance` diz de qual conexão é o evento — sem isso, com várias
    // conexões, o status de uma sobrescreveria o da outra.
    await whatsappService.processarWebhook(body.event, body.data, body.instance).catch(err =>
      logger.error({ err }, 'Erro ao processar webhook WhatsApp'),
    );
  }

  reply.send({ ok: true });
}
