import type { FastifyRequest, FastifyReply } from 'fastify';
import { whatsappService } from './service';
import { logger } from '../logger';

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
  const body         = request.body as { instance_name?: string } | null;
  const instanceName = body?.instance_name?.trim();

  if (!instanceName) {
    reply.code(400).send({ detail: 'Campo "instance_name" é obrigatório.' });
    return;
  }

  if (!process.env.EVOLUTION_API_URL || !process.env.EVOLUTION_API_KEY) {
    reply.code(503).send({ detail: 'Evolution API não configurada no servidor. Defina EVOLUTION_API_URL e EVOLUTION_API_KEY.' });
    return;
  }

  try {
    const resultado = await whatsappService.conectar(instanceName);
    reply.send(resultado);
  } catch (err) {
    logger.error({ err }, 'Erro ao iniciar conexão WhatsApp');
    reply.code(502).send({ detail: 'Não foi possível conectar à Evolution API. Verifique as credenciais.' });
  }
}

// ── GET /api/whatsapp/qrcode ──────────────────────────────────────────────────

export async function getQrCode(
  _request: FastifyRequest,
  reply:    FastifyReply,
): Promise<void> {
  const resultado = await whatsappService.getQrCode();
  if (!resultado) {
    reply.code(404).send({ detail: 'Nenhuma instância configurada. Chame POST /api/whatsapp/connect primeiro.' });
    return;
  }
  reply.send(resultado);
}

// ── DELETE /api/whatsapp/disconnect ──────────────────────────────────────────

export async function desconectar(
  _request: FastifyRequest,
  reply:    FastifyReply,
): Promise<void> {
  await whatsappService.desconectar();
  reply.send({ mensagem: 'WhatsApp desconectado com sucesso.' });
}

// ── DELETE /api/whatsapp/instance ─────────────────────────────────────────────

export async function deletarInstancia(
  _request: FastifyRequest,
  reply:    FastifyReply,
): Promise<void> {
  await whatsappService.deletarInstancia();
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

  const body = request.body as { event?: string; data?: unknown } | null;
  if (body?.event) {
    await whatsappService.processarWebhook(body.event, body.data).catch(err =>
      logger.error({ err }, 'Erro ao processar webhook WhatsApp'),
    );
  }

  reply.send({ ok: true });
}
