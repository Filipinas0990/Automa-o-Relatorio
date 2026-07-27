import { evolutionReq } from '../whatsapp/service';
import { whatsappRepository } from '../whatsapp/repository';
import { disparosRepository } from './repository';
import type { InstanciaStatus } from './repository';
import { logger } from '../logger';
import type { DisparoGrupo } from '../database/schema';
import {
  campanhasConfigurado,
  callbackUrl,
  enfileirarDisparoNoCampanhas,
} from './campaignsClient';

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

/** Conexão que pode originar um disparo — a do gestor ou uma global. */
export interface ConexaoDisparo {
  instanceName: string;
  nome:         string;
  tipo:         'gestor' | 'global';
  status:       InstanciaStatus;
  numero:       string | null;
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

/** Resultado de um grupo, como o campanhas devolve no callback. */
export interface ResultadoGrupo {
  jid:    string;
  nome?:  string;
  status: 'ok' | 'erro';
  erro?:  string | null;
}

/**
 * Retorno do executarDisparo: 'direto' já traz o resultado (envio síncrono);
 * 'campanhas' só confirma que foi enfileirado — o resultado chega no callback.
 */
export type ResultadoDisparo =
  | { modo: 'direto';    enviados: number; falhas: number }
  | { modo: 'campanhas'; grupos: number };

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

  /**
   * Conexões que podem originar um disparo (opção "b"): a do gestor logado
   * + todas as conexões globais da tela Conexões. O gestor escolhe uma no
   * passo 1 do wizard.
   */
  async listarConexoes(gestorId: number): Promise<ConexaoDisparo[]> {
    const conexoes: ConexaoDisparo[] = [];

    const gestorInst = await disparosRepository.getInstancia(gestorId);
    if (gestorInst) {
      conexoes.push({
        instanceName: gestorInst.instanceName,
        nome:         'Meu WhatsApp',
        tipo:         'gestor',
        status:       gestorInst.status as InstanciaStatus,
        numero:       gestorInst.numeroConectado ?? null,
      });
    }

    const globais = await whatsappRepository.listConfigs();
    for (const g of globais) {
      conexoes.push({
        instanceName: g.instanceName,
        nome:         g.nome ?? g.instanceName,
        tipo:         'global',
        status:       g.status as InstanciaStatus,
        numero:       g.numeroConectado ?? null,
      });
    }

    return conexoes;
  },

  /**
   * Instâncias que este gestor tem permissão de usar (a dele + as globais).
   * Impede que ele puxe grupos ou dispare pela conexão de outro gestor.
   */
  async instanciasPermitidas(gestorId: number): Promise<Set<string>> {
    const conexoes = await this.listarConexoes(gestorId);
    return new Set(conexoes.map((c) => c.instanceName));
  },

  /** Grupos do gestor logado — usa a conexão dele (atalho do wizard antigo). */
  async listarGrupos(gestorId: number): Promise<GrupoWhatsApp[]> {
    const registro = await disparosRepository.getInstancia(gestorId);
    if (!registro) return [];
    return this.listarGruposDeInstancia(registro.instanceName);
  },

  /** Grupos de uma instância Evolution específica (a conexão escolhida). */
  async listarGruposDeInstancia(instanceName: string): Promise<GrupoWhatsApp[]> {
    const { ok, data } = await evolutionReq<unknown>(
      'GET', `/group/fetchAllGroups/${instanceName}?getParticipants=false`,
    );

    if (!ok) {
      logger.error({ instanceName, data }, 'Falha ao listar grupos na Evolution');
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
   * Instância Evolution efetiva do disparo: a que foi escolhida no wizard
   * (disparo.instanceName) ou, para disparos antigos sem escolha, a do gestor.
   */
  async resolverInstancia(disparo: DisparoGrupo): Promise<string> {
    if (disparo.instanceName) return disparo.instanceName;
    const registro = await disparosRepository.getInstancia(disparo.gestorId);
    if (!registro) throw new Error('Disparo sem conexão de WhatsApp');
    return registro.instanceName;
  },

  /**
   * Dispara. Se o motor de campanhas estiver configurado (CAMPAIGNS_API_URL),
   * enfileira lá — o envio é assíncrono e o resultado chega em finalizarDisparo
   * via callback. Senão, faz o envio direto pela Evolution (fallback síncrono),
   * para o sistema não parar caso o campanhas ainda não esteja no ar.
   */
  async executarDisparo(disparoId: number): Promise<ResultadoDisparo> {
    if (!campanhasConfigurado()) {
      const r = await this.executarDisparoDireto(disparoId);
      return { modo: 'direto', ...r };
    }

    const disparo = await disparosRepository.getDisparo(disparoId);
    if (!disparo) throw new Error(`Disparo ${disparoId} não encontrado`);

    const instanceName = await this.resolverInstancia(disparo);

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

    const { ok, status, data } = await enfileirarDisparoNoCampanhas({
      disparoId,
      instance:    instanceName,
      message:     disparo.mensagem,
      groups:      grupos,
      medias:      midias,
      callbackUrl: callbackUrl() || undefined,
    });

    if (!ok) {
      await disparosRepository.atualizarDisparo(disparoId, { status: 'erro' });
      throw new Error(
        `Campanhas recusou o disparo (HTTP ${status}): ${JSON.stringify(data).slice(0, 200)}`,
      );
    }

    logger.info(
      { disparoId, grupos: grupos.length, instancia: instanceName },
      'Disparo enfileirado no campanhas',
    );
    return { modo: 'campanhas', grupos: grupos.length };
  },

  /**
   * Finaliza um disparo com o resultado devolvido pelo campanhas (callback):
   * grava um log por grupo e recalcula status/próximo envio — a mesma
   * finalização que o envio direto faz ao terminar.
   */
  async finalizarDisparo(
    disparoId:  number,
    resultados: ResultadoGrupo[],
  ): Promise<{ enviados: number; falhas: number }> {
    const disparo = await disparosRepository.getDisparo(disparoId);
    if (!disparo) throw new Error(`Disparo ${disparoId} não encontrado`);

    let enviados = 0;
    let falhas   = 0;

    for (const r of resultados) {
      if (r.status === 'ok') enviados += 1;
      else falhas += 1;

      await disparosRepository.registrarLog({
        disparoId,
        grupoJid:  r.jid,
        grupoNome: r.nome ?? null,
        status:    r.status === 'ok' ? 'ok' : 'erro',
        erro:      r.erro ?? null,
      });
    }

    const agora   = new Date();
    const proximo = calcularProximoEnvio(disparo, agora);

    await disparosRepository.atualizarDisparo(disparoId, {
      status:       proximo ? 'agendado' : (falhas > 0 && enviados === 0 ? 'erro' : 'enviado'),
      ultimoEnvio:  agora,
      proximoEnvio: proximo,
    });

    logger.info({ disparoId, enviados, falhas, proximo }, 'Disparo finalizado (callback do campanhas)');
    return { enviados, falhas };
  },

  /**
   * Envio direto pela Evolution (fallback). Em cada grupo: manda a mensagem
   * como texto e, em seguida, cada criativo como imagem com a própria legenda —
   * que é como a oferta fica legível no grupo quando são vários produtos.
   * O grupo conta como enviado se ao menos uma peça chegou.
   */
  async executarDisparoDireto(disparoId: number): Promise<{ enviados: number; falhas: number }> {
    const disparo = await disparosRepository.getDisparo(disparoId);
    if (!disparo) throw new Error(`Disparo ${disparoId} não encontrado`);

    const instanceName = await this.resolverInstancia(disparo);

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
          const r = await this.enviarTextoGrupo(instanceName, grupo.jid, disparo.mensagem);
          if (r.ok) algoChegou = true;
          else erros.push(`texto: ${JSON.stringify(r.data).slice(0, 200)}`);
          await sleep(DELAY_ENTRE_GRUPOS_MS);
        }

        // 2) Cada criativo, com a própria legenda
        for (const midia of midias) {
          const r = await this.enviarMidiaGrupo(instanceName, grupo.jid, {
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
