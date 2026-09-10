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

/** Resposta da listagem de grupos: a lista + o estado do cache por trás. */
export interface ListagemGrupos {
  grupos:        GrupoWhatsApp[];
  /** Quando o cache foi sincronizado (null = conexão sem instância). */
  atualizadoEm:  Date | null;
  /** true = tem um refresh rodando em background; vale reconsultar em breve. */
  sincronizando: boolean;
  /** Erro do último sync, quando ele falhou mas ainda temos cache para mostrar. */
  aviso:         string | null;
}

export interface OpcoesListagem {
  /** Ignora o cache e espera a Evolution responder (botão "Atualizar"). */
  forcar?: boolean;
}

/** Depois disso o cache é servido, mas já pede refresh em background. */
const TTL_GRUPOS_MS = 15 * 60 * 1000;

/** Sugestões iniciais de horário — o gestor edita a lista depois. */
export const HORARIOS_PADRAO = ['08:00', '09:00', '12:00', '15:00', '18:00'];

/** "HH:MM" de 00:00 a 23:59. */
export function horarioValido(valor: unknown): valor is string {
  return typeof valor === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(valor);
}

/**
 * O fetchAllGroups é pesado e demorado: se duas abas (ou o refresh em
 * background e um "Atualizar" clicado junto) pedirem a mesma instância, elas
 * compartilham a MESMA chamada em vez de brigar por ela na Evolution.
 */
const syncsEmVoo = new Map<string, Promise<{ grupos: GrupoWhatsApp[]; atualizadoEm: Date }>>();

/** Busca os grupos na Evolution e regrava o cache. Nunca chame direto do
 *  request se der para servir cache — isto é o caminho lento. */
function sincronizarGrupos(
  instanceName: string,
): Promise<{ grupos: GrupoWhatsApp[]; atualizadoEm: Date }> {
  const emVoo = syncsEmVoo.get(instanceName);
  if (emVoo) return emVoo;

  const promessa = (async () => {
    let grupos: GrupoWhatsApp[];
    try {
      grupos = await buscarGruposNaEvolution(instanceName);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao sincronizar os grupos';
      await disparosRepository.registrarErroSyncGrupos(instanceName, msg).catch(() => {});
      throw err;
    }
    const atualizadoEm = await disparosRepository.salvarGruposCache(instanceName, grupos);
    return { grupos, atualizadoEm };
  })().finally(() => syncsEmVoo.delete(instanceName));

  syncsEmVoo.set(instanceName, promessa);
  return promessa;
}

/** A chamada crua à Evolution, com o parser dos dois formatos de resposta. */
async function buscarGruposNaEvolution(instanceName: string): Promise<GrupoWhatsApp[]> {
  const { ok, data } = await evolutionReq<unknown>(
    'GET', `/group/fetchAllGroups/${instanceName}?getParticipants=false`,
    undefined,
    // Sincronizar centenas de grupos passa fácil dos 30s padrão.
    { timeoutMs: 120_000 },
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

/**
 * Monta o que vai para o grupo. Havendo criativo, a mensagem NÃO sai como um
 * balão de texto solto antes das imagens: ela vira a legenda de CADA imagem (a
 * descrição que o WhatsApp mostra embaixo da foto), com o rótulo do produto
 * logo abaixo. Sem criativo, segue como texto puro.
 *
 * Já foi só na primeira imagem, para não repetir o cabeçalho. Não funciona: no
 * WhatsApp cada foto é uma mensagem que pode ser encaminhada, salva e lida
 * sozinha — quem abre a segunda oferta não vê legenda nenhuma, e a foto chega
 * sem dizer de que farmácia é nem até quando vale. Repetir é o certo aqui.
 */
function montarEnvio(
  mensagem: string,
  midias: MidiaDisparo[],
): { texto: string; midias: MidiaDisparo[] } {
  const texto = (mensagem ?? '').trim();
  if (!texto || midias.length === 0) return { texto, midias };

  return {
    texto:  '',
    midias: midias.map((midia) => {
      const rotulo = midia.rotulo?.trim();
      return { ...midia, rotulo: rotulo ? `${texto}\n\n${rotulo}` : texto };
    }),
  };
}

/**
 * Quantos produtos saem em CADA postagem de um disparo repetido.
 *
 * Número do dono (09/09/2026), de propósito sem campo na tela: é regra do
 * sistema, não configuração por campanha. Mexer aqui muda todos os disparos
 * repetidos a partir do próximo envio.
 */
export const PRODUTOS_POR_ENVIO = 3;

/**
 * Escolhe o lote de criativos desta ocorrência e diz onde a próxima começa.
 *
 * Sequencial na ordem em que o gestor montou (não sorteia): sorteio
 * independente repetiria produto na mesma semana e deixaria outro sem sair
 * nenhuma vez — e ninguém consegue auditar no histórico o que já foi.
 *
 * O lote atravessa o fim da lista (18,19,0 numa lista de 20) em vez de sair
 * curto: toda postagem tem o mesmo peso, e a fronteira dos lotes anda a cada
 * volta, então as artes não saem sempre agrupadas do mesmo jeito.
 *
 * Lista menor ou igual ao lote → vai inteira e o cursor volta a zero; não há o
 * que rodiziar, e repetir a mesma arte dentro de uma postagem seria pior.
 */
export function fatiarRodizio(
  midias:   MidiaDisparo[],
  cursor:   number,
  porEnvio: number = PRODUTOS_POR_ENVIO,
): { lote: MidiaDisparo[]; proximoCursor: number } {
  const total = midias.length;
  if (total === 0 || total <= porEnvio) return { lote: midias, proximoCursor: 0 };

  // Tolera cursor sujo (negativo, ou maior que a lista se o gestor editou o disparo)
  const inicio = ((Math.trunc(cursor) % total) + total) % total;

  const lote: MidiaDisparo[] = [];
  for (let i = 0; i < porEnvio; i += 1) lote.push(midias[(inicio + i) % total]);

  return { lote, proximoCursor: (inicio + porEnvio) % total };
}

/**
 * Aplica o rodízio quando o disparo se repete. No envio único a lista vai
 * inteira: só existe uma ocorrência, então fatiar deixaria a maior parte dos
 * produtos que o cliente pediu sem sair nunca.
 */
function loteDaVez(
  disparo: DisparoGrupo,
  midias:  MidiaDisparo[],
): { lote: MidiaDisparo[]; proximoCursor: number } {
  if (disparo.repetir === 'nunca') return { lote: midias, proximoCursor: 0 };
  return fatiarRodizio(midias, disparo.cursorMidia ?? 0);
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
        // Acabou de conectar (leu o QR agora): já vai buscando os grupos por
        // trás, para o passo 2 do disparo não começar do zero e lento.
        if (registro.status !== 'open') {
          void sincronizarGrupos(registro.instanceName).catch((err) => {
            logger.warn({ err, instanceName: registro.instanceName }, 'Aquecimento do cache de grupos falhou');
          });
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

  // ── Horários pré-definidos ─────────────────────────────────────────────────

  /**
   * Horários que o gestor usa para agendar. Na primeira vez semeia os padrões
   * — assim o modal de agendamento nunca abre sem nenhuma sugestão, e o gestor
   * ajusta a lista depois em Configurações.
   */
  async listarHorarios(gestorId: number) {
    const existentes = await disparosRepository.listarHorarios(gestorId);
    if (existentes.length > 0) return existentes;

    await disparosRepository.criarHorariosPadrao(gestorId, HORARIOS_PADRAO);
    return disparosRepository.listarHorarios(gestorId);
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
  async listarGrupos(gestorId: number, opts?: OpcoesListagem): Promise<ListagemGrupos> {
    const registro = await disparosRepository.getInstancia(gestorId);
    if (!registro) return { grupos: [], atualizadoEm: null, sincronizando: false, aviso: null };
    return this.listarGruposDeInstancia(registro.instanceName, opts);
  },

  /**
   * Grupos de uma instância Evolution — servidos do cache (migration 0020).
   *
   * O fetchAllGroups da Evolution leva dezenas de segundos numa conta com
   * muitos grupos, então só esperamos por ele quando não há alternativa:
   *   • cache ausente (primeira vez nesta conexão) ou `forcar` → sincroniza e espera;
   *   • cache velho  → devolve o que tem AGORA e atualiza em background;
   *   • cache fresco → devolve direto.
   */
  async listarGruposDeInstancia(
    instanceName: string,
    opts?: OpcoesListagem,
  ): Promise<ListagemGrupos> {
    const sync = await disparosRepository.getSyncGrupos(instanceName);

    if (!sync || opts?.forcar) {
      const { grupos, atualizadoEm } = await sincronizarGrupos(instanceName);
      return { grupos, atualizadoEm, sincronizando: false, aviso: null };
    }

    const cache = await disparosRepository.listarGruposCache(instanceName);
    // Ordena aqui, e não no ORDER BY: a collation do banco joga nome acentuado
    // ("Ótica", "Água") para o fim da lista.
    const grupos = cache
      .map((g) => ({ jid: g.jid, nome: g.nome, participantes: g.participantes }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

    const idadeMs = Date.now() - sync.sincronizadoEm.getTime();
    const velho   = idadeMs > TTL_GRUPOS_MS;

    if (velho) {
      // Fire-and-forget: quem pediu não paga a espera. O single-flight lá
      // dentro garante que várias abas não disparem syncs concorrentes.
      void sincronizarGrupos(instanceName).catch((err) => {
        logger.warn({ err, instanceName }, 'Refresh de grupos em background falhou');
      });
    }

    return {
      grupos,
      atualizadoEm:  sync.sincronizadoEm,
      sincronizando: velho,
      aviso:         sync.erro,
    };
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

    // Disparo repetido leva só o lote da vez — ver fatiarRodizio
    const rodizio = loteDaVez(disparo, midias);

    // A mensagem vira legenda de cada criativo — ver montarEnvio
    const envio = montarEnvio(disparo.mensagem, rodizio.lote);

    const { ok, status, data } = await enfileirarDisparoNoCampanhas({
      disparoId,
      instance:    instanceName,
      message:     envio.texto || undefined,
      groups:      grupos,
      medias:      envio.midias,
      callbackUrl: callbackUrl() || undefined,
    });

    if (!ok) {
      await disparosRepository.atualizarDisparo(disparoId, { status: 'erro' });
      throw new Error(
        `Campanhas recusou o disparo (HTTP ${status}): ${JSON.stringify(data).slice(0, 200)}`,
      );
    }

    // Só depois do aceite: recusa no motor não consome produto do rodízio
    await disparosRepository.atualizarDisparo(disparoId, { cursorMidia: rodizio.proximoCursor });

    logger.info(
      {
        disparoId, grupos: grupos.length, instancia: instanceName,
        produtos: `${rodizio.lote.length}/${midias.length}`, proximoCursor: rodizio.proximoCursor,
      },
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

    // Disparo repetido leva só o lote da vez — ver fatiarRodizio
    const rodizio = loteDaVez(disparo, midias);

    // A mensagem vira legenda de cada criativo — ver montarEnvio
    const envio = montarEnvio(disparo.mensagem, rodizio.lote);

    let enviados = 0;
    let falhas   = 0;

    for (const grupo of grupos) {
      const erros: string[] = [];
      let algoChegou = false;

      try {
        // 1) Texto solto — só quando o disparo não tem criativo
        if (envio.texto) {
          const r = await this.enviarTextoGrupo(instanceName, grupo.jid, envio.texto);
          if (r.ok) algoChegou = true;
          else erros.push(`texto: ${JSON.stringify(r.data).slice(0, 200)}`);
          await sleep(DELAY_ENTRE_GRUPOS_MS);
        }

        // 2) Cada criativo, com a própria legenda
        for (const midia of envio.midias) {
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
      // Avança mesmo com falha parcial: repetir o mesmo lote na próxima
      // ocorrência atrasaria a lista inteira por causa de um grupo fora do ar.
      cursorMidia:  rodizio.proximoCursor,
    });

    logger.info(
      {
        disparoId, enviados, falhas, proximo,
        produtos: `${rodizio.lote.length}/${midias.length}`, proximoCursor: rodizio.proximoCursor,
      },
      'Disparo em grupos executado',
    );
    return { enviados, falhas };
  },
};

/** Lê `horarios_json` — sempre ordenado e sem repetido. */
export function lerHorarios(json: string | null): string[] {
  if (!json) return [];
  try {
    const lista = JSON.parse(json) as unknown;
    if (!Array.isArray(lista)) return [];
    return [...new Set(lista.filter(horarioValido))].sort();
  } catch {
    return [];
  }
}

const emMinutos = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/**
 * Minutos desde a meia-noite **no fuso do disparo**.
 *
 * Não dá para usar `getHours()`: o servidor roda em UTC e o horário que o
 * gestor escolheu ("08:00") é de Brasília — daria 3 horas de diferença.
 */
function minutosNoFuso(data: Date, timezone: string): number {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const [h, m] = fmt.format(data).split(':').map(Number);
  return h * 60 + m;
}

/**
 * Próxima data de envio: passa por todos os horários fixos do dia e só então
 * avança conforme a repetição. Retorna null quando não há mais envio (o
 * disparo é finalizado).
 *
 * Com horários [08:00, 18:00] e repetição diária: 08:00 → 18:00 → 08:00 do dia
 * seguinte. Sem repetição, sai nos horários do dia marcado e encerra.
 */
export function calcularProximoEnvio(disparo: DisparoGrupo, base: Date): Date | null {
  const referencia = disparo.proximoEnvio ? new Date(disparo.proximoEnvio) : base;
  const proximo    = new Date(referencia);
  const horarios   = lerHorarios(disparo.horariosJson);
  const timezone   = disparo.timezone || 'America/Sao_Paulo';

  /** Desloca por diferença de minutos — mexer na hora absoluta ignoraria o fuso. */
  const irPara = (hhmm: string) => {
    proximo.setMinutes(proximo.getMinutes() + (emMinutos(hhmm) - minutosNoFuso(proximo, timezone)));
  };

  /** Próximo horário fixo ainda por vir no mesmo dia. */
  const proximoNoMesmoDia = (): boolean => {
    if (horarios.length < 2) return false;
    const agora = minutosNoFuso(proximo, timezone);
    const seguinte = horarios.find((h) => emMinutos(h) > agora);
    if (!seguinte) return false;
    irPara(seguinte);
    return true;
  };

  const avancarOcorrencia = (): boolean => {
    switch (disparo.repetir) {
      case 'diario':  proximo.setDate(proximo.getDate() + 1);   break;
      case 'semanal': proximo.setDate(proximo.getDate() + 7);   break;
      case 'mensal':  proximo.setMonth(proximo.getMonth() + 1); break;
      default: return false;
    }
    // Recomeça o dia pelo primeiro horário da lista
    if (horarios.length > 0) irPara(horarios[0]);
    return true;
  };

  const avancar = (): boolean => proximoNoMesmoDia() || avancarOcorrencia();

  /** Passou da data de término escolhida pelo gestor (null = sem término). */
  const passouDoFim = (): boolean =>
    disparo.repetirAte !== null && proximo.getTime() > new Date(disparo.repetirAte).getTime();

  if (!avancar()) return null;
  if (passouDoFim()) return null;

  // Se a referência ficou no passado (ex.: serviço parado), avança até o futuro
  while (proximo.getTime() <= base.getTime()) {
    if (!avancar()) return null;
    if (passouDoFim()) return null;
  }

  return proximo;
}
