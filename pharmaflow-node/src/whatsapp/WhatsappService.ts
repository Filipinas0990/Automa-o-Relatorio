import { logger } from '../logger';
import { FalhaExterna } from '../compartilhado/erros';
import type { WhatsAppConfig } from '../database/schema';
import type { ClienteEvolution } from './ClienteEvolution';
import type { WhatsAppStatus, WhatsappRepository } from './WhatsappRepository';

function normalizarTelefone(tel: string): string {
  const d = tel.replace(/\D/g, '');
  return d.startsWith('55') && d.length >= 12 ? d : `55${d}`;
}

/** Uma conexão da tela "Conexões", já com o status conferido na Evolution. */
export interface ConexaoWhatsApp {
  id:        number;
  instancia: string;
  nome:      string;
  status:    WhatsAppStatus;
  numero:    string | null;
  conectado: boolean;
}

/**
 * Quem recebe uma mensagem de WhatsApp entrante (evento `messages.upsert` do
 * webhook) e decide o que fazer com ela. Hoje é o módulo de ads (bot de
 * criação de campanhas via WhatsApp).
 *
 * Injetado por SETTER (`definirRoteador`), não pelo construtor: ads precisa de
 * uma instância de WhatsappService para ENVIAR respostas, e WhatsappService
 * precisa de uma instância de AdsService para RECEBER mensagens — uma
 * dependência mútua de verdade entre as duas classes finais. A raiz de
 * composição monta o WhatsappService primeiro, monta o AdsService recebendo-o
 * pelo construtor, e só então fecha o laço chamando `definirRoteador`.
 */
export interface RoteadorMensagemWhatsapp {
  processarMensagem(telefone: string, texto: string, imagemBase64?: string): Promise<void>;
}

/**
 * Conexões de WhatsApp (Evolution API) usadas para notificações e no bot de
 * ads, e o roteamento de mensagens/eventos recebidos via webhook.
 */
export class WhatsappService {
  private roteadorMensagens: RoteadorMensagemWhatsapp | null = null;

  constructor(
    private readonly config: WhatsappRepository,
    private readonly evolution: ClienteEvolution,
  ) {}

  definirRoteador(roteador: RoteadorMensagemWhatsapp): void {
    this.roteadorMensagens = roteador;
  }

  /**
   * Status ao vivo de UMA instância, com o banco sincronizado de quebra.
   * Se a Evolution não responde, devolve o último status conhecido — melhor um
   * dado velho do que a tela inteira falhar por causa de uma conexão morta.
   */
  private async statusAoVivo(config: WhatsAppConfig): Promise<WhatsAppStatus> {
    try {
      const { data } = await this.evolution.req<{ instance?: { state?: string }; state?: string }>(
        'GET', `/instance/connectionState/${config.instanceName}`,
      );
      const live = (data?.instance?.state ?? data?.state ?? 'close') as WhatsAppStatus;
      if (live !== config.status) {
        await this.config.atualizarStatus(config.id, live);
      }
      return live;
    } catch (err) {
      logger.warn({ err, instancia: config.instanceName }, 'Não foi possível consultar status da Evolution API');
      return config.status as WhatsAppStatus;
    }
  }

  /**
   * Resolve qual conexão uma operação deve atingir. Sem `instanceName` cai na
   * "default" (a mais antiga) — é o que mantém de pé quem chama as rotas antigas,
   * de quando existia uma conexão só.
   */
  private async resolverConfig(instanceName?: string | null): Promise<WhatsAppConfig | null> {
    const alvo = instanceName?.trim();
    return alvo
      ? this.config.getConfigByInstance(alvo)
      : this.config.getConfig();
  }

  /**
   * Todas as conexões cadastradas, com status conferido na Evolution.
   * As consultas saem em paralelo: uma instância lenta não segura as outras.
   */
  async listarConexoes(): Promise<{ conexoes: ConexaoWhatsApp[]; configurado: boolean }> {
    if (!process.env.EVOLUTION_API_URL) return { conexoes: [], configurado: false };

    const configs = await this.config.listConfigs();
    const conexoes = await Promise.all(configs.map(async (c): Promise<ConexaoWhatsApp> => {
      const status = await this.statusAoVivo(c);
      return {
        id:        c.id,
        instancia: c.instanceName,
        nome:      c.nome ?? c.instanceName,
        status,
        numero:    c.numeroConectado ?? null,
        conectado: status === 'open',
      };
    }));

    return { conexoes, configurado: true };
  }

  /**
   * Status resumido para quem só quer saber "tem WhatsApp de pé?" (o pontinho
   * verde da sidebar, por exemplo). Com várias conexões, prioriza uma conectada.
   */
  async getStatus() {
    const { conexoes, configurado } = await this.listarConexoes();
    if (!configurado) {
      return { conectado: false, status: 'close' as WhatsAppStatus, instancia: null, numero: null, configurado: false };
    }

    const escolhida = conexoes.find((c) => c.conectado) ?? conexoes[0];
    if (!escolhida) {
      return { conectado: false, status: 'close' as WhatsAppStatus, instancia: null, numero: null, configurado: true };
    }

    return {
      conectado:   escolhida.conectado,
      status:      escolhida.status,
      instancia:   escolhida.instancia,
      numero:      escolhida.numero,
      configurado: true,
      /** Quantas conexões existem ao todo — a tela Conexões lista todas. */
      total:       conexoes.length,
    };
  }

  /**
   * Cria (ou reconecta) uma instância na Evolution API e retorna o QR code.
   * Cada `instanceName` distinto é uma conexão à parte — chamar de novo com um
   * nome já existente só reconecta aquela, sem mexer nas outras.
   */
  async conectar(instanceName: string, nome?: string | null) {
    try {
      // Tenta criar a instância (se já existir a Evolution API retorna erro ignorável)
      await this.evolution.req('POST', '/instance/create', {
        instanceName,
        qrcode:      true,
        integration: 'WHATSAPP-BAILEYS',
      });

      const { data: qrData } = await this.evolution.req<{
        base64?: string; qrcode?: { base64?: string };
      }>('GET', `/instance/connect/${instanceName}`);

      const qrCode = qrData?.base64 ?? qrData?.qrcode?.base64 ?? null;

      await this.config.salvarConfig({
        instanceName,
        status:          'connecting',
        qrCode,
        numeroConectado: null,
        // `undefined` preserva o nome já salvo (caso de reconexão).
        nome:            nome?.trim() ? nome.trim() : undefined,
      });

      return { instancia: instanceName, status: 'connecting', qr_code: qrCode };
    } catch (err) {
      logger.error({ err }, 'Erro ao iniciar conexão WhatsApp');
      throw new FalhaExterna('Não foi possível conectar à Evolution API. Verifique as credenciais.');
    }
  }

  /**
   * Retorna QR code atualizado e verifica se já conectou.
   * O frontend deve chamar este endpoint a cada 3-5 segundos enquanto status = connecting.
   */
  async getQrCode(instanceName?: string | null) {
    const config = await this.resolverConfig(instanceName);
    if (!config) return null;

    try {
      const { data: stateData } = await this.evolution.req<{ instance?: { state?: string }; state?: string }>(
        'GET', `/instance/connectionState/${config.instanceName}`,
      );
      const liveStatus = (stateData?.instance?.state ?? stateData?.state ?? 'close') as WhatsAppStatus;

      if (liveStatus === 'open') {
        await this.config.atualizarStatus(config.id, 'open', null);
        return { status: 'open' as WhatsAppStatus, qr_code: null, instancia: config.instanceName };
      }

      const { data: qrData } = await this.evolution.req<{
        base64?: string; qrcode?: { base64?: string };
      }>('GET', `/instance/connect/${config.instanceName}`);

      const qrCode = qrData?.base64 ?? qrData?.qrcode?.base64 ?? config.qrCode;
      if (qrCode !== config.qrCode) {
        await this.config.atualizarStatus(config.id, 'connecting', qrCode);
      }

      return { status: liveStatus, qr_code: qrCode, instancia: config.instanceName };
    } catch (err) {
      logger.warn({ err }, 'Erro ao obter QR code da Evolution API');
      return { status: config.status as WhatsAppStatus, qr_code: config.qrCode, instancia: config.instanceName };
    }
  }

  /** Desconecta UMA conexão (logout) e atualiza o banco. */
  async desconectar(instanceName?: string | null): Promise<boolean> {
    const config = await this.resolverConfig(instanceName);
    if (!config) return false;

    try {
      await this.evolution.req('DELETE', `/instance/logout/${config.instanceName}`);
    } catch (err) {
      logger.warn({ err, instancia: config.instanceName }, 'Erro ao fazer logout na Evolution API');
    }

    await this.config.atualizarStatus(config.id, 'close', null, null);
    return true;
  }

  /** Remove UMA conexão por completo — da Evolution API e do banco. */
  async deletarInstancia(instanceName?: string | null): Promise<boolean> {
    const config = await this.resolverConfig(instanceName);
    if (!config) return false;

    try {
      await this.evolution.req('DELETE', `/instance/delete/${config.instanceName}`);
    } catch (err) {
      logger.warn({ err, instancia: config.instanceName }, 'Erro ao deletar instância na Evolution API');
    }

    await this.config.deletarConfig(config.id);
    return true;
  }

  /**
   * Envia mensagem de texto para um número via Evolution API.
   *
   * Com várias conexões cadastradas, usa a primeira que estiver conectada — a
   * notificação de reunião não pode morrer só porque a conexão mais antiga caiu.
   * `instanceName` força uma conexão específica.
   */
  async enviarMensagem(telefone: string, mensagem: string, instanceName?: string | null): Promise<boolean> {
    const config = instanceName
      ? await this.config.getConfigByInstance(instanceName)
      : (await this.config.listConfigs()).find((c) => c.status === 'open') ?? null;

    if (!config || config.status !== 'open') {
      logger.warn({ status: config?.status ?? 'sem conexão conectada' }, 'WhatsApp não conectado — notificação ignorada');
      return false;
    }

    const numero = normalizarTelefone(telefone);
    try {
      const { ok, data } = await this.evolution.req('POST', `/message/sendText/${config.instanceName}`, {
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
  }

  /**
   * Processa eventos recebidos via webhook da Evolution API.
   * Atualiza status e QR code no banco automaticamente.
   *
   * `instanceName` vem do campo `instance` do payload da Evolution e diz de QUAL
   * conexão é o evento. Sem ele, um QR da conexão B sobrescrevia a linha da A.
   */
  async processarWebhook(evento: string, data: unknown, instanceName?: string | null): Promise<void> {
    const config = await this.resolverConfig(instanceName);
    if (!config) {
      logger.warn({ instancia: instanceName }, 'Webhook de instância desconhecida — ignorado');
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload = data as any;

    if (evento === 'connection.update') {
      const state: WhatsAppStatus = payload?.state ?? 'close';
      const phone: string | null  = payload?.phoneNumber ?? null;
      await this.config.atualizarStatus(
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
        await this.config.atualizarStatus(config.id, 'connecting', qrCode);
        logger.info({ instancia: config.instanceName }, 'WhatsApp: QR code atualizado via webhook');
      }
    }

    // Mensagem recebida de um gestor — roteia para quem trata o bot (ads)
    if (evento === 'messages.upsert') {
      const message = payload?.messages?.[0];
      // Ignora mensagens enviadas pelo próprio bot e status
      if (!message || message.key?.fromMe || message.messageType === 'protocolMessage') return;

      const from: string  = message.key?.remoteJid?.replace('@s.whatsapp.net', '') ?? '';
      const texto: string = message.message?.conversation
        ?? message.message?.extendedTextMessage?.text
        ?? '';

      // Imagem: Evolution API entrega em base64 dentro do payload
      const imagemBase64: string | undefined =
        message.message?.imageMessage?.jpegThumbnail
        ?? message.message?.base64
        ?? undefined;

      if (!from) return;
      if (!this.roteadorMensagens) {
        logger.warn('Mensagem recebida antes do roteador ser definido — ignorada');
        return;
      }

      await this.roteadorMensagens.processarMensagem(from, texto, imagemBase64);
    }
  }
}
