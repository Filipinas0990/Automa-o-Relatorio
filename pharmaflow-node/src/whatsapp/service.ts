import { whatsappRepository } from './repository';
import type { WhatsAppStatus } from './repository';
import { logger } from '../logger';

const EVOLUTION_URL = () => process.env.EVOLUTION_API_URL || '';
const EVOLUTION_KEY = () => process.env.EVOLUTION_API_KEY || '';

// ── Utilitários ───────────────────────────────────────────────────────────────

function normalizarTelefone(tel: string): string {
  const d = tel.replace(/\D/g, '');
  return d.startsWith('55') && d.length >= 12 ? d : `55${d}`;
}

async function evolutionReq<T = unknown>(
  method: string,
  path:   string,
  body?:  unknown,
): Promise<{ ok: boolean; status: number; data: T }> {
  const url = `${EVOLUTION_URL()}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      apikey:          EVOLUTION_KEY(),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await res.json().catch(() => ({} as any));
  return { ok: res.ok, status: res.status, data: data as T };
}

// ── Service ───────────────────────────────────────────────────────────────────

export const whatsappService = {

  /** Retorna o status atual (consulta a Evolution API em tempo real) */
  async getStatus() {
    if (!EVOLUTION_URL()) {
      return { conectado: false, status: 'close' as WhatsAppStatus, instancia: null, numero: null, configurado: false };
    }

    const config = await whatsappRepository.getConfig();
    if (!config) {
      return { conectado: false, status: 'close' as WhatsAppStatus, instancia: null, numero: null, configurado: true };
    }

    try {
      const { data } = await evolutionReq<{ instance?: { state?: string }; state?: string }>(
        'GET', `/instance/connectionState/${config.instanceName}`,
      );
      const liveStatus = (data?.instance?.state ?? data?.state ?? 'close') as WhatsAppStatus;

      if (liveStatus !== config.status) {
        await whatsappRepository.atualizarStatus(config.id, liveStatus);
      }

      return {
        conectado:    liveStatus === 'open',
        status:       liveStatus,
        instancia:    config.instanceName,
        numero:       config.numeroConectado ?? null,
        configurado:  true,
      };
    } catch (err) {
      logger.warn({ err }, 'Não foi possível consultar status da Evolution API');
      return {
        conectado:   config.status === 'open',
        status:      config.status as WhatsAppStatus,
        instancia:   config.instanceName,
        numero:      config.numeroConectado ?? null,
        configurado: true,
      };
    }
  },

  /**
   * Cria (ou reconecta) uma instância na Evolution API e retorna o QR code.
   * Chame quando o usuário clicar em "Conectar WhatsApp" no frontend.
   */
  async conectar(instanceName: string) {
    // Tenta criar a instância (se já existir a Evolution API retorna erro ignorável)
    await evolutionReq('POST', '/instance/create', {
      instanceName,
      qrcode:      true,
      integration: 'WHATSAPP-BAILEYS',
    });

    // Busca QR code
    const { data: qrData } = await evolutionReq<{
      base64?: string; qrcode?: { base64?: string };
    }>('GET', `/instance/connect/${instanceName}`);

    const qrCode = qrData?.base64 ?? qrData?.qrcode?.base64 ?? null;

    await whatsappRepository.salvarConfig({
      instanceName,
      status:          'connecting',
      qrCode,
      numeroConectado: null,
    });

    return { instancia: instanceName, status: 'connecting', qr_code: qrCode };
  },

  /**
   * Retorna QR code atualizado e verifica se já conectou.
   * O frontend deve chamar este endpoint a cada 3-5 segundos enquanto status = connecting.
   */
  async getQrCode() {
    const config = await whatsappRepository.getConfig();
    if (!config) return null;

    // Verifica status ao vivo
    try {
      const { data: stateData } = await evolutionReq<{ instance?: { state?: string }; state?: string }>(
        'GET', `/instance/connectionState/${config.instanceName}`,
      );
      const liveStatus = (stateData?.instance?.state ?? stateData?.state ?? 'close') as WhatsAppStatus;

      if (liveStatus === 'open') {
        await whatsappRepository.atualizarStatus(config.id, 'open', null);
        return { status: 'open' as WhatsAppStatus, qr_code: null, instancia: config.instanceName };
      }

      // Atualiza QR code se ainda está conectando
      const { data: qrData } = await evolutionReq<{
        base64?: string; qrcode?: { base64?: string };
      }>('GET', `/instance/connect/${config.instanceName}`);

      const qrCode = qrData?.base64 ?? qrData?.qrcode?.base64 ?? config.qrCode;
      if (qrCode !== config.qrCode) {
        await whatsappRepository.atualizarStatus(config.id, 'connecting', qrCode);
      }

      return { status: liveStatus, qr_code: qrCode, instancia: config.instanceName };
    } catch (err) {
      logger.warn({ err }, 'Erro ao obter QR code da Evolution API');
      return { status: config.status as WhatsAppStatus, qr_code: config.qrCode, instancia: config.instanceName };
    }
  },

  /** Desconecta o WhatsApp (logout) e atualiza o banco */
  async desconectar() {
    const config = await whatsappRepository.getConfig();
    if (!config) return;

    try {
      await evolutionReq('DELETE', `/instance/logout/${config.instanceName}`);
    } catch (err) {
      logger.warn({ err }, 'Erro ao fazer logout na Evolution API');
    }

    await whatsappRepository.atualizarStatus(config.id, 'close', null, null);
  },

  /** Remove completamente a instância da Evolution API e do banco */
  async deletarInstancia() {
    const config = await whatsappRepository.getConfig();
    if (!config) return;

    try {
      await evolutionReq('DELETE', `/instance/delete/${config.instanceName}`);
    } catch (err) {
      logger.warn({ err }, 'Erro ao deletar instância na Evolution API');
    }

    await whatsappRepository.deletarConfig(config.id);
  },

  /**
   * Envia mensagem de texto para um número via Evolution API.
   * Só envia se o status estiver 'open'. Retorna true em caso de sucesso.
   */
  async enviarMensagem(telefone: string, mensagem: string): Promise<boolean> {
    const config = await whatsappRepository.getConfig();

    if (!config || config.status !== 'open') {
      logger.warn({ status: config?.status ?? 'sem config' }, 'WhatsApp não conectado — notificação ignorada');
      return false;
    }

    const numero = normalizarTelefone(telefone);
    try {
      const { ok, data } = await evolutionReq('POST', `/message/sendText/${config.instanceName}`, {
        number: numero,
        text:   mensagem,
      });

      if (!ok) {
        logger.error({ data, numero }, 'Falha ao enviar mensagem WhatsApp');
        return false;
      }

      logger.info({ numero, instancia: config.instanceName }, 'Mensagem WhatsApp enviada');
      return true;
    } catch (err) {
      logger.error({ err, numero }, 'Erro ao enviar mensagem WhatsApp');
      return false;
    }
  },

  /**
   * Processa eventos recebidos via webhook da Evolution API.
   * Atualiza status e QR code no banco automaticamente.
   */
  async processarWebhook(evento: string, data: unknown): Promise<void> {
    const config = await whatsappRepository.getConfig();
    if (!config) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload = data as any;

    if (evento === 'connection.update') {
      const state: WhatsAppStatus = payload?.state ?? 'close';
      const phone: string | null  = payload?.phoneNumber ?? null;
      await whatsappRepository.atualizarStatus(
        config.id,
        state,
        state === 'open' ? null : config.qrCode,
        phone ?? config.numeroConectado,
      );
      logger.info({ state, phone }, 'WhatsApp: evento connection.update recebido');
    }

    if (evento === 'qrcode.updated') {
      const qrCode: string | null = payload?.qrcode?.base64 ?? payload?.base64 ?? null;
      if (qrCode) {
        await whatsappRepository.atualizarStatus(config.id, 'connecting', qrCode);
        logger.info({ instancia: config.instanceName }, 'WhatsApp: QR code atualizado via webhook');
      }
    }

    // Mensagem recebida de um gestor — roteia para o módulo de ads
    if (evento === 'messages.upsert') {
      const message = payload?.messages?.[0];
      // Ignora mensagens enviadas pelo próprio bot e status
      if (!message || message.key?.fromMe || message.messageType === 'protocolMessage') return;

      const from: string        = message.key?.remoteJid?.replace('@s.whatsapp.net', '') ?? '';
      const texto: string       = message.message?.conversation
        ?? message.message?.extendedTextMessage?.text
        ?? '';

      // Imagem: Evolution API entrega em base64 dentro do payload
      const imagemBase64: string | undefined =
        message.message?.imageMessage?.jpegThumbnail
        ?? message.message?.base64
        ?? undefined;

      if (!from) return;

      // Import lazy para evitar dependência circular
      const { adsService } = await import('../ads/service');
      await adsService.processarMensagem(from, texto, imagemBase64);
    }
  },
};
