import { evolutionReq } from '../whatsapp/service';
import { disparosRepository } from './repository';
import type { InstanciaStatus } from './repository';
import { logger } from '../logger';
import type { DisparoGrupo } from '../database/schema';

const EVOLUTION_URL = () => process.env.EVOLUTION_API_URL || '';

/** Valores que vêm do .env.example e denunciam que ninguém preencheu ainda. */
const PLACEHOLDERS = ['sua-evolution-api.com', 'sua-api-key-aqui', 'SEU_', 'localhost:0'];

/**
 * Diz por que a Evolution não está utilizável, ou null se parece OK.
 * Sem isso o gestor recebe um "não foi possível conectar" genérico e vai
 * procurar defeito no lugar errado.
 */
export function motivoEvolutionIndisponivel(): string | null {
  const url = process.env.EVOLUTION_API_URL || '';
  const key = process.env.EVOLUTION_API_KEY || '';

  if (!url) return 'EVOLUTION_API_URL não está definida no .env do servidor.';
  if (!key) return 'EVOLUTION_API_KEY não está definida no .env do servidor.';

  const suspeito = PLACEHOLDERS.find((p) => url.includes(p) || key.includes(p));
  if (suspeito) {
    return `O .env do servidor ainda está com o valor de exemplo ("${suspeito}"). `
      + 'Preencha EVOLUTION_API_URL e EVOLUTION_API_KEY com os dados da sua Evolution API.';
  }

  return null;
}

/** Nome determinístico da instância Evolution de um gestor. */
export function nomeInstancia(gestorId: number): string {
  return `gestor_${gestorId}`;
}

export interface GrupoWhatsApp {
  jid:           string;   // ...@g.us
  nome:          string;
  participantes: number | null;
}

export interface GrupoSelecionado {
  jid:  string;
  nome: string;
}

/** Um criativo do disparo. Um pedido de oferta gera vários. */
export interface MidiaDisparo {
  b64:     string;   // base64 puro, sem o prefixo data:
  mime:    string;
  rotulo?: string;   // vira a legenda da imagem (ex.: "Dipirona — R$ 9,90")
}

/**
 * Intervalo entre envios para não estourar limite da Evolution / do WhatsApp.
 * Configurável para que a suíte de testes não gaste 1,5s por mensagem.
 */
const DELAY_ENTRE_GRUPOS_MS = Number(process.env.DISPARO_DELAY_MS ?? 1500);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const disparosService = {

  configurado(): boolean {
    return Boolean(EVOLUTION_URL()) && motivoEvolutionIndisponivel() === null;
  },

  // ── Conexão do gestor ──────────────────────────────────────────────────────

  /**
   * Cria (ou reconecta) a instância Evolution do gestor e devolve o QR code.
   * Cada gestor tem UMA conexão — é nela que estão os grupos dos clientes dele.
   */
  async conectarGestor(gestorId: number) {
    const instanceName = nomeInstancia(gestorId);

    // Se já existir na Evolution, o create retorna erro ignorável
    await evolutionReq('POST', '/instance/create', {
      instanceName,
      qrcode:      true,
      integration: 'WHATSAPP-BAILEYS',
    });

    const { data: qrData } = await evolutionReq<{
      base64?: string; qrcode?: { base64?: string };
    }>('GET', `/instance/connect/${instanceName}`);

    const qrCode = qrData?.base64 ?? qrData?.qrcode?.base64 ?? null;

    const existente = await disparosRepository.getInstancia(gestorId);
    if (existente) {
      await disparosRepository.atualizarInstancia(existente.id, { status: 'connecting', qrCode });
    } else {
      await disparosRepository.criarInstancia({
        gestorId, instanceName, status: 'connecting', qrCode,
      });
    }

    return { instancia: instanceName, status: 'connecting' as InstanciaStatus, qr_code: qrCode };
  },

  /**
   * Status ao vivo da conexão do gestor (e QR code se ainda conectando).
   * Sincroniza o banco com o que a Evolution responde.
   */
  async statusGestor(gestorId: number) {
    const registro = await disparosRepository.getInstancia(gestorId);

    if (!registro) {
      return {
        instancia: null, status: 'close' as InstanciaStatus,
        qr_code: null, numero: null, conectado: false, configurado: this.configurado(),
      };
    }

    try {
      const { data } = await evolutionReq<{ instance?: { state?: string }; state?: string }>(
        'GET', `/instance/connectionState/${registro.instanceName}`,
      );
      const statusAoVivo = (data?.instance?.state ?? data?.state ?? 'close') as InstanciaStatus;

      let qrCode = registro.qrCode;

      if (statusAoVivo === 'open') {
        qrCode = null;
        if (registro.status !== 'open' || registro.qrCode) {
          await disparosRepository.atualizarInstancia(registro.id, { status: 'open', qrCode: null });
        }
      } else {
        // Ainda conectando: busca QR atualizado
        const { data: qrData } = await evolutionReq<{
          base64?: string; qrcode?: { base64?: string };
        }>('GET', `/instance/connect/${registro.instanceName}`);
        qrCode = qrData?.base64 ?? qrData?.qrcode?.base64 ?? registro.qrCode;

        if (statusAoVivo !== registro.status || qrCode !== registro.qrCode) {
          await disparosRepository.atualizarInstancia(registro.id, { status: statusAoVivo, qrCode });
        }
      }

      return {
        instancia:   registro.instanceName,
        status:      statusAoVivo,
        qr_code:     qrCode,
        numero:      registro.numeroConectado,
        conectado:   statusAoVivo === 'open',
        configurado: this.configurado(),
      };
    } catch (err) {
      logger.warn({ err, gestorId }, 'Não foi possível consultar status da instância na Evolution');
      return {
        instancia:   registro.instanceName,
        status:      registro.status as InstanciaStatus,
        qr_code:     registro.qrCode,
        numero:      registro.numeroConectado,
        conectado:   registro.status === 'open',
        configurado: this.configurado(),
      };
    }
  },

  async desconectarGestor(gestorId: number): Promise<void> {
    const registro = await disparosRepository.getInstancia(gestorId);
    if (!registro) return;

    try {
      await evolutionReq('DELETE', `/instance/logout/${registro.instanceName}`);
    } catch (err) {
      logger.warn({ err, gestorId }, 'Erro ao desconectar instância do gestor');
    }

    await disparosRepository.atualizarInstancia(registro.id, {
      status: 'close', qrCode: null, numeroConectado: null,
    });
  },

  // ── Grupos ─────────────────────────────────────────────────────────────────

  /** Grupos de WhatsApp do gestor (os grupos de oferta dos clientes dele). */
  async listarGrupos(gestorId: number): Promise<GrupoWhatsApp[]> {
    const registro = await disparosRepository.getInstancia(gestorId);
    if (!registro) return [];

    const { ok, data } = await evolutionReq<unknown>(
      'GET', `/group/fetchAllGroups/${registro.instanceName}?getParticipants=false`,
    );

    if (!ok) {
      logger.error({ gestorId, data }, 'Falha ao listar grupos na Evolution');
      throw new Error('Não foi possível listar os grupos. Verifique se o WhatsApp está conectado.');
    }

    // A Evolution ora devolve array puro, ora { groups: [...] }
    const bruto = Array.isArray(data)
      ? data
      : ((data as { groups?: unknown[] })?.groups ?? []);

    return (bruto as Record<string, unknown>[])
      .map((g) => ({
        jid:  String(g.id ?? g.jid ?? ''),
        nome: String(g.subject ?? g.name ?? 'Grupo sem nome'),
        participantes:
          typeof g.size === 'number' ? g.size
          : Array.isArray(g.participants) ? g.participants.length
          : null,
      }))
      .filter((g) => g.jid.endsWith('@g.us'))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  },

  // ── Envio ──────────────────────────────────────────────────────────────────

  async enviarTextoGrupo(instanceName: string, jid: string, texto: string) {
    return evolutionReq('POST', `/message/sendText/${instanceName}`, {
      number: jid,
      text:   texto,
    });
  },

  async enviarMidiaGrupo(instanceName: string, jid: string, params: {
    media:    string;          // base64 puro (sem data:)
    mimetype: string;
    caption:  string;
  }) {
    return evolutionReq('POST', `/message/sendMedia/${instanceName}`, {
      number:    jid,
      mediatype: 'image',
      mimetype:  params.mimetype,
      media:     params.media,
      caption:   params.caption,
      fileName:  'oferta.png',
    });
  },

  /**
   * Executa um disparo. Em cada grupo: manda a mensagem como texto e, em
   * seguida, cada criativo como imagem com a própria legenda — que é como a
   * oferta fica legível no grupo quando são vários produtos.
   * O grupo conta como enviado se ao menos uma peça chegou.
   */
  async executarDisparo(disparoId: number): Promise<{ enviados: number; falhas: number }> {
    const disparo = await disparosRepository.getDisparo(disparoId);
    if (!disparo) throw new Error(`Disparo ${disparoId} não encontrado`);

    const registro = await disparosRepository.getInstancia(disparo.gestorId);
    if (!registro) throw new Error('Gestor sem WhatsApp conectado');

    await disparosRepository.atualizarDisparo(disparoId, { status: 'enviando' });

    let grupos: GrupoSelecionado[] = [];
    try {
      grupos = JSON.parse(disparo.gruposJson) as GrupoSelecionado[];
    } catch {
      grupos = [];
    }

    let midias: MidiaDisparo[] = [];
    try {
      midias = disparo.midiasJson ? (JSON.parse(disparo.midiasJson) as MidiaDisparo[]) : [];
    } catch {
      midias = [];
    }

    let enviados = 0;
    let falhas   = 0;

    for (const grupo of grupos) {
      const erros: string[] = [];
      let algoChegou = false;

      try {
        // 1) A mensagem (só uma vez por grupo)
        if (disparo.mensagem.trim()) {
          const r = await this.enviarTextoGrupo(registro.instanceName, grupo.jid, disparo.mensagem);
          if (r.ok) algoChegou = true;
          else erros.push(`texto: ${JSON.stringify(r.data).slice(0, 200)}`);
          await sleep(DELAY_ENTRE_GRUPOS_MS);
        }

        // 2) Cada criativo, com a própria legenda
        for (const midia of midias) {
          const r = await this.enviarMidiaGrupo(registro.instanceName, grupo.jid, {
            media:    midia.b64,
            mimetype: midia.mime || 'image/png',
            caption:  midia.rotulo ?? '',
          });
          if (r.ok) algoChegou = true;
          else erros.push(`${midia.rotulo ?? 'imagem'}: ${JSON.stringify(r.data).slice(0, 200)}`);
          await sleep(DELAY_ENTRE_GRUPOS_MS);
        }
      } catch (err) {
        erros.push(err instanceof Error ? err.message : String(err));
      }

      if (algoChegou) {
        enviados += 1;
        await disparosRepository.registrarLog({
          disparoId, grupoJid: grupo.jid, grupoNome: grupo.nome,
          status: 'ok',
          erro: erros.length ? `parcial — ${erros.join(' | ')}`.slice(0, 500) : null,
        });
      } else {
        falhas += 1;
        await disparosRepository.registrarLog({
          disparoId, grupoJid: grupo.jid, grupoNome: grupo.nome,
          status: 'erro', erro: erros.join(' | ').slice(0, 500) || 'Nada foi enviado',
        });
      }
    }

    const agora = new Date();
    const proximo = calcularProximoEnvio(disparo, agora);

    await disparosRepository.atualizarDisparo(disparoId, {
      status:       proximo ? 'agendado' : (falhas > 0 && enviados === 0 ? 'erro' : 'enviado'),
      ultimoEnvio:  agora,
      proximoEnvio: proximo,
    });

    logger.info({ disparoId, enviados, falhas, proximo }, 'Disparo em grupos executado');
    return { enviados, falhas };
  },
};

/**
 * Próxima data de envio conforme a repetição. Retorna null quando não repete
 * (o disparo então é finalizado).
 */
export function calcularProximoEnvio(disparo: DisparoGrupo, base: Date): Date | null {
  const referencia = disparo.proximoEnvio ? new Date(disparo.proximoEnvio) : base;
  const proximo    = new Date(referencia);

  const avancar = (): boolean => {
    switch (disparo.repetir) {
      case 'diario':  proximo.setDate(proximo.getDate() + 1);   return true;
      case 'semanal': proximo.setDate(proximo.getDate() + 7);   return true;
      case 'mensal':  proximo.setMonth(proximo.getMonth() + 1); return true;
      default: return false;
    }
  };

  if (!avancar()) return null;

  // Se a referência ficou no passado (ex.: serviço parado), avança até o futuro
  while (proximo.getTime() <= base.getTime()) {
    if (!avancar()) return null;
  }

  return proximo;
}
