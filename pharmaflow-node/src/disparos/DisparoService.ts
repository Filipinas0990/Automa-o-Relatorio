import { logger } from '../logger';
import { ErroAplicacao, RequisicaoInvalida, NaoEncontrado, Proibido, Conflito, FalhaExterna, Indisponivel } from '../compartilhado/erros';
import type { DisparoGrupo, DisparoGrupoLog } from '../database/schema';
import type { ClienteEvolution } from '../whatsapp/ClienteEvolution';
import type { WhatsappRepository } from '../whatsapp/WhatsappRepository';
import type { SolicitacaoRepository } from '../ofertas/SolicitacaoRepository';
import type { ClienteCampanhas } from './ClienteCampanhas';
import { DisparoRepository, type InstanciaStatus } from './DisparoRepository';
import { fatiarRodizio, PRODUTOS_POR_ENVIO, loteDaVez, montarEnvio, listaAcabou } from './rodizio';
import { horarioValido, ehFimDeSemana, calcularProximoEnvio } from './agendamento';
import type {
  GrupoWhatsApp, ListagemGrupos, OpcoesListagem, ConexaoDisparo,
  GrupoSelecionado, MidiaDisparo, ResultadoGrupo, ResultadoDisparo,
} from './types';

export { fatiarRodizio, PRODUTOS_POR_ENVIO, listaAcabou, horarioValido, ehFimDeSemana, calcularProximoEnvio };
export type { GrupoWhatsApp, ListagemGrupos, OpcoesListagem, ConexaoDisparo, GrupoSelecionado, MidiaDisparo, ResultadoGrupo, ResultadoDisparo };

/** Valores que vêm do .env.example e denunciam que ninguém preencheu ainda. */
const PLACEHOLDERS = ['sua-evolution-api.com', 'sua-api-key-aqui', 'SEU_', 'localhost:0'];

/** Sugestões iniciais de horário — o gestor edita a lista depois. */
export const HORARIOS_PADRAO = ['08:00', '09:00', '12:00', '15:00', '18:00'];

/** Depois disso o cache é servido, mas já pede refresh em background. */
const TTL_GRUPOS_MS = 15 * 60 * 1000;

/**
 * Quanto o request espera um sync antes de responder com o que tem. O proxy
 * da Vercel derruba resposta que passa de ~25s, e o fetchAllGroups de uma
 * conta com ~200 grupos leva quase 1 min (conexão "bruuno", 01/10): esperar
 * até o fim fazia a tela mostrar "Erro no servidor" mesmo com o sync dando
 * certo por trás.
 */
const ESPERA_MAX_SYNC_MS = 20 * 1000;

/**
 * Intervalo entre envios para não estourar limite da Evolution / do WhatsApp.
 * Configurável para que a suíte de testes não gaste 1,5s por mensagem.
 */
const DELAY_ENTRE_GRUPOS_MS = () => Number(process.env.DISPARO_DELAY_MS ?? 1500);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface CriarDisparoBody {
  titulo:          string;
  mensagem:        string;
  midias?:         MidiaDisparo[];
  /** Produtos do catálogo que geraram os criativos — alimenta o "Recentes". */
  produtos?:       { id: number; nome: string }[];
  grupos:          GrupoSelecionado[];
  quando:          'agora' | 'agendado';
  agendado_para?:  string | null;   // ISO
  repetir?:        'nunca' | 'diario' | 'semanal' | 'mensal';
  /** Horários fixos do dia ("HH:MM"). Vazio = só o de agendado_para. */
  horarios?:       string[];
  /** ISO — fim da repetição. Ausente/null = repete até o gestor cancelar. */
  repetir_ate?:    string | null;
  /** true = a lista de produtos dá a volta; só a data de término encerra. */
  repetir_produtos?: boolean;
  /**
   * true = o gestor liberou sábado e domingo nesta campanha. Ausente/false
   * (padrão) mantém a regra do dono: nada sai no fim de semana.
   */
  permitir_fim_de_semana?: boolean;
  timezone?:       string;
  farmacia_id?:    number | null;
  solicitacao_id?: number | null;
  instance?:       string | null;   // conexão Evolution escolhida no passo 1
  /** Ciência explícita de que um grupo é de outro cliente — ver a trava no POST. */
  confirmar_grupo_de_outro_cliente?: boolean;
}

export type ResultadoCriacaoDisparo =
  | { tipo: 'enfileirado'; id: number; totalGrupos: number }
  | { tipo: 'enviado';     id: number; enviados: number; falhas: number }
  | { tipo: 'agendado';    id: number; agendadoPara: Date | null; repetir: string };

/**
 * Disparo de ofertas nos grupos de WhatsApp.
 *
 * Multi-tenant por GESTOR: cada gestor tem uma conexão de WhatsApp e enxerga
 * somente os grupos dela. O escopo é implícito — tudo deriva do gestorId
 * recebido, então não há como um gestor alcançar os grupos ou os disparos de
 * outro.
 */
export class DisparoService {
  constructor(
    private readonly disparos:     DisparoRepository,
    private readonly whatsapp:     WhatsappRepository,
    private readonly evolution:    ClienteEvolution,
    private readonly campanhas:    ClienteCampanhas,
    private readonly solicitacoes: SolicitacaoRepository,
  ) {}

  /**
   * Diz por que a Evolution não está utilizável, ou null se parece OK.
   * Sem isso o gestor recebe um "não foi possível conectar" genérico e vai
   * procurar defeito no lugar errado.
   */
  motivoIndisponivel(): string | null {
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

  configurado(): boolean {
    return Boolean(process.env.EVOLUTION_API_URL || '') && this.motivoIndisponivel() === null;
  }

  /** Nome determinístico da instância Evolution de um gestor. */
  private nomeInstancia(gestorId: number): string {
    return `gestor_${gestorId}`;
  }

  // ── Conexão do gestor ────────────────────────────────────────────────────

  /**
   * Cria (ou reconecta) a instância Evolution do gestor e devolve o QR code.
   * Cada gestor tem UMA conexão — é nela que estão os grupos dos clientes dele.
   */
  async conectarGestor(gestorId: number) {
    const motivo = this.motivoIndisponivel();
    if (motivo) throw new Indisponivel(motivo);

    try {
      const instanceName = this.nomeInstancia(gestorId);

      // Se já existir na Evolution, o create retorna erro ignorável
      await this.evolution.req('POST', '/instance/create', {
        instanceName,
        qrcode:      true,
        integration: 'WHATSAPP-BAILEYS',
      });

      const { data: qrData } = await this.evolution.req<{
        base64?: string; qrcode?: { base64?: string };
      }>('GET', `/instance/connect/${instanceName}`);

      const qrCode = qrData?.base64 ?? qrData?.qrcode?.base64 ?? null;

      const existente = await this.disparos.getInstancia(gestorId);
      if (existente) {
        await this.disparos.atualizarInstancia(existente.id, { status: 'connecting', qrCode });
      } else {
        await this.disparos.criarInstancia({ gestorId, instanceName, status: 'connecting', qrCode });
      }

      return { instancia: instanceName, status: 'connecting' as InstanciaStatus, qr_code: qrCode };
    } catch (err) {
      if (err instanceof ErroAplicacao) throw err;
      logger.error({ err, gestorId }, 'Erro ao conectar WhatsApp do gestor');
      // Devolve a causa real (DNS, recusa de conexão, timeout) — o genérico
      // manda o gestor procurar defeito no lugar errado.
      const causa = err instanceof Error ? err.message : String(err);
      throw new FalhaExterna(
        `Não foi possível falar com a Evolution API (${process.env.EVOLUTION_API_URL}): ${causa}`,
      );
    }
  }

  /**
   * Status ao vivo da conexão do gestor (e QR code se ainda conectando).
   * Sincroniza o banco com o que a Evolution responde.
   */
  async statusGestor(gestorId: number) {
    const registro = await this.disparos.getInstancia(gestorId);

    if (!registro) {
      return {
        instancia: null, status: 'close' as InstanciaStatus,
        qr_code: null, numero: null, conectado: false, configurado: this.configurado(),
      };
    }

    try {
      const { data } = await this.evolution.req<{ instance?: { state?: string }; state?: string }>(
        'GET', `/instance/connectionState/${registro.instanceName}`,
      );
      const statusAoVivo = (data?.instance?.state ?? data?.state ?? 'close') as InstanciaStatus;

      let qrCode = registro.qrCode;

      if (statusAoVivo === 'open') {
        qrCode = null;
        if (registro.status !== 'open' || registro.qrCode) {
          await this.disparos.atualizarInstancia(registro.id, { status: 'open', qrCode: null });
        }
        // Acabou de conectar (leu o QR agora): já vai buscando os grupos por
        // trás, para o passo 2 do disparo não começar do zero e lento.
        if (registro.status !== 'open') {
          void this.sincronizarGrupos(registro.instanceName).catch((err) => {
            logger.warn({ err, instanceName: registro.instanceName }, 'Aquecimento do cache de grupos falhou');
          });
        }
      } else {
        const { data: qrData } = await this.evolution.req<{
          base64?: string; qrcode?: { base64?: string };
        }>('GET', `/instance/connect/${registro.instanceName}`);
        qrCode = qrData?.base64 ?? qrData?.qrcode?.base64 ?? registro.qrCode;

        if (statusAoVivo !== registro.status || qrCode !== registro.qrCode) {
          await this.disparos.atualizarInstancia(registro.id, { status: statusAoVivo, qrCode });
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
  }

  async desconectarGestor(gestorId: number): Promise<void> {
    const registro = await this.disparos.getInstancia(gestorId);
    if (!registro) return;

    try {
      await this.evolution.req('DELETE', `/instance/logout/${registro.instanceName}`);
    } catch (err) {
      logger.warn({ err, gestorId }, 'Erro ao desconectar instância do gestor');
    }

    await this.disparos.atualizarInstancia(registro.id, {
      status: 'close', qrCode: null, numeroConectado: null,
    });
  }

  // ── Horários pré-definidos ───────────────────────────────────────────────

  /**
   * Horários que o gestor usa para agendar. Na primeira vez semeia os padrões
   * — assim o modal de agendamento nunca abre sem nenhuma sugestão, e o gestor
   * ajusta a lista depois em Configurações.
   */
  async listarHorarios(gestorId: number) {
    const existentes = await this.disparos.listarHorarios(gestorId);
    if (existentes.length > 0) return existentes;

    await this.disparos.criarHorariosPadrao(gestorId, HORARIOS_PADRAO);
    return this.disparos.listarHorarios(gestorId);
  }

  async adicionarHorario(gestorId: number, horarioBruto: unknown, rotuloBruto: unknown) {
    if (!horarioValido(horarioBruto)) {
      throw new RequisicaoInvalida('Horário inválido — use o formato HH:MM.');
    }
    const rotulo = typeof rotuloBruto === 'string' ? rotuloBruto.trim().slice(0, 40) || null : null;
    await this.disparos.criarHorario(gestorId, horarioBruto, rotulo);
    return this.listarHorarios(gestorId);
  }

  async removerHorario(gestorId: number, id: number): Promise<void> {
    if (!await this.disparos.removerHorario(gestorId, id)) {
      throw new NaoEncontrado('Horário não encontrado');
    }
  }

  // ── Grupos ───────────────────────────────────────────────────────────────

  /**
   * Conexões que podem originar um disparo (opção "b"): a do gestor logado
   * + todas as conexões globais da tela Conexões. O gestor escolhe uma no
   * passo 1 do wizard.
   */
  async listarConexoes(gestorId: number): Promise<ConexaoDisparo[]> {
    const conexoes: ConexaoDisparo[] = [];

    const gestorInst = await this.disparos.getInstancia(gestorId);
    if (gestorInst) {
      conexoes.push({
        instanceName: gestorInst.instanceName,
        nome:         'Meu WhatsApp',
        tipo:         'gestor',
        status:       gestorInst.status as InstanciaStatus,
        numero:       gestorInst.numeroConectado ?? null,
      });
    }

    const globais = await this.whatsapp.listConfigs();
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
  }

  /**
   * Instâncias que este gestor tem permissão de usar (a dele + as globais).
   * Impede que ele puxe grupos ou dispare pela conexão de outro gestor.
   */
  async instanciasPermitidas(gestorId: number): Promise<Set<string>> {
    const conexoes = await this.listarConexoes(gestorId);
    return new Set(conexoes.map((c) => c.instanceName));
  }

  /** Grupos do gestor logado — usa a conexão dele (atalho do wizard antigo). */
  async listarGrupos(gestorId: number, opts?: OpcoesListagem): Promise<ListagemGrupos> {
    const registro = await this.disparos.getInstancia(gestorId);
    if (!registro) return { grupos: [], atualizadoEm: null, sincronizando: false, aviso: null };
    return this.listarGruposDeInstancia(registro.instanceName, opts);
  }

  /** Grupos de uma conexão escolhida, verificando que o gestor pode usá-la. */
  async gruposDaConexaoOuDoGestor(
    gestorId: number, instance: string | undefined, opts?: OpcoesListagem,
  ): Promise<ListagemGrupos> {
    if (!instance) return this.listarGrupos(gestorId, opts);
    const permitidas = await this.instanciasPermitidas(gestorId);
    if (!permitidas.has(instance)) {
      throw new Proibido('Esta conexão não está disponível para você.');
    }
    return this.listarGruposDeInstancia(instance, opts);
  }

  /**
   * Grupos de uma instância Evolution — servidos do cache (migration 0020).
   *
   * O fetchAllGroups da Evolution leva dezenas de segundos numa conta com
   * muitos grupos, então só esperamos por ele quando não há alternativa:
   *   • cache ausente (primeira vez nesta conexão) ou `forcar` → sincroniza e
   *     espera até ESPERA_MAX_SYNC_MS; passou disso, devolve o cache que houver
   *     com `sincronizando: true` e o sync termina em background;
   *   • cache velho  → devolve o que tem AGORA e atualiza em background;
   *   • cache fresco → devolve direto.
   */
  async listarGruposDeInstancia(
    instanceName: string,
    opts?: OpcoesListagem,
  ): Promise<ListagemGrupos> {
    const sync = await this.disparos.getSyncGrupos(instanceName);

    if (!sync || opts?.forcar) {
      const emVoo = this.sincronizarGrupos(instanceName);
      let timer: NodeJS.Timeout | undefined;
      const estourou = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ESPERA_MAX_SYNC_MS);
      });
      try {
        const pronto = await Promise.race([emVoo, estourou]);
        if (pronto) {
          return { grupos: pronto.grupos, atualizadoEm: pronto.atualizadoEm, sincronizando: false, aviso: null };
        }
      } finally {
        clearTimeout(timer);
      }
      emVoo.catch((err) => {
        logger.warn({ err, instanceName }, 'Sync de grupos em background falhou');
      });
      const cache = await this.disparos.listarGruposCache(instanceName);
      return {
        grupos: cache
          .map((g) => ({ jid: g.jid, nome: g.nome, participantes: g.participantes }))
          .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
        atualizadoEm:  sync?.sincronizadoEm ?? null,
        sincronizando: true,
        aviso:         null,
      };
    }

    const cache = await this.disparos.listarGruposCache(instanceName);
    // Ordena aqui, e não no ORDER BY: a collation do banco joga nome acentuado
    // ("Ótica", "Água") para o fim da lista.
    const grupos = cache
      .map((g) => ({ jid: g.jid, nome: g.nome, participantes: g.participantes }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

    const idadeMs = Date.now() - sync.sincronizadoEm.getTime();
    const velho   = idadeMs > TTL_GRUPOS_MS;

    if (velho) {
      void this.sincronizarGrupos(instanceName).catch((err) => {
        logger.warn({ err, instanceName }, 'Refresh de grupos em background falhou');
      });
    }

    return {
      grupos,
      atualizadoEm:  sync.sincronizadoEm,
      sincronizando: velho,
      aviso:         sync.erro,
    };
  }

  /**
   * O fetchAllGroups é pesado e demorado: se duas abas (ou o refresh em
   * background e um "Atualizar" clicado junto) pedirem a mesma instância, elas
   * compartilham a MESMA chamada em vez de brigar por ela na Evolution.
   */
  private readonly syncsEmVoo = new Map<string, Promise<{ grupos: GrupoWhatsApp[]; atualizadoEm: Date }>>();

  /** Busca os grupos na Evolution e regrava o cache. Nunca chame direto do
   *  request se der para servir cache — isto é o caminho lento. */
  private sincronizarGrupos(instanceName: string): Promise<{ grupos: GrupoWhatsApp[]; atualizadoEm: Date }> {
    const emVoo = this.syncsEmVoo.get(instanceName);
    if (emVoo) return emVoo;

    const promessa = (async () => {
      let grupos: GrupoWhatsApp[];
      try {
        grupos = await this.buscarGruposNaEvolution(instanceName);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Falha ao sincronizar os grupos';
        await this.disparos.registrarErroSyncGrupos(instanceName, msg).catch(() => {});
        throw err;
      }
      const atualizadoEm = await this.disparos.salvarGruposCache(instanceName, grupos);
      return { grupos, atualizadoEm };
    })().finally(() => this.syncsEmVoo.delete(instanceName));

    this.syncsEmVoo.set(instanceName, promessa);
    return promessa;
  }

  /** A chamada crua à Evolution, com o parser dos dois formatos de resposta. */
  private async buscarGruposNaEvolution(instanceName: string): Promise<GrupoWhatsApp[]> {
    const { ok, data } = await this.evolution.req<unknown>(
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

  /** Para cada grupo, as farmácias com campanha ainda rodando nele (ver DisparoRepository.donosDeGrupos). */
  async donosDeGrupos(gestorId: number, jids: string[]) {
    return this.disparos.donosDeGrupos(gestorId, jids);
  }

  // ── Envio ────────────────────────────────────────────────────────────────

  private async enviarTextoGrupo(instanceName: string, jid: string, texto: string) {
    return this.evolution.req('POST', `/message/sendText/${instanceName}`, {
      number: jid,
      text:   texto,
    });
  }

  private async enviarMidiaGrupo(instanceName: string, jid: string, params: {
    media:    string;          // base64 puro (sem data:)
    mimetype: string;
    caption:  string;
  }) {
    return this.evolution.req('POST', `/message/sendMedia/${instanceName}`, {
      number:    jid,
      mediatype: 'image',
      mimetype:  params.mimetype,
      media:     params.media,
      caption:   params.caption,
      fileName:  'oferta.png',
    });
  }

  /**
   * Instância Evolution efetiva do disparo: a que foi escolhida no wizard
   * (disparo.instanceName) ou, para disparos antigos sem escolha, a do gestor.
   */
  private async resolverInstancia(disparo: DisparoGrupo): Promise<string> {
    if (disparo.instanceName) return disparo.instanceName;
    const registro = await this.disparos.getInstancia(disparo.gestorId);
    if (!registro) throw new Error('Disparo sem conexão de WhatsApp');
    return registro.instanceName;
  }

  /**
   * Dispara. Se o motor de campanhas estiver configurado (CAMPAIGNS_API_URL),
   * enfileira lá — o envio é assíncrono e o resultado chega em finalizarDisparo
   * via callback. Senão, faz o envio direto pela Evolution (fallback síncrono),
   * para o sistema não parar caso o campanhas ainda não esteja no ar.
   */
  async executarDisparo(disparoId: number): Promise<ResultadoDisparo> {
    if (!this.campanhas.configurado()) {
      const r = await this.executarDisparoDireto(disparoId);
      return { modo: 'direto', ...r };
    }

    const disparo = await this.disparos.getDisparo(disparoId);
    if (!disparo) throw new Error(`Disparo ${disparoId} não encontrado`);

    const instanceName = await this.resolverInstancia(disparo);

    await this.disparos.atualizarDisparo(disparoId, { status: 'enviando' });

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

    const { ok, status, data } = await this.campanhas.enfileirar({
      disparoId,
      instance:    instanceName,
      message:     envio.texto || undefined,
      groups:      grupos,
      medias:      envio.midias,
      callbackUrl: this.campanhas.callbackUrl() || undefined,
    });

    if (!ok) {
      await this.disparos.atualizarDisparo(disparoId, { status: 'erro' });
      throw new Error(
        `Campanhas recusou o disparo (HTTP ${status}): ${JSON.stringify(data).slice(0, 200)}`,
      );
    }

    // Só depois do aceite: recusa no motor não consome produto do rodízio
    await this.disparos.atualizarDisparo(disparoId, { cursorMidia: rodizio.proximoCursor });

    logger.info(
      {
        disparoId, grupos: grupos.length, instancia: instanceName,
        produtos: `${rodizio.lote.length}/${midias.length}`, proximoCursor: rodizio.proximoCursor,
      },
      'Disparo enfileirado no campanhas',
    );
    return { modo: 'campanhas', grupos: grupos.length };
  }

  /**
   * Finaliza um disparo com o resultado devolvido pelo campanhas (callback):
   * grava um log por grupo e recalcula status/próximo envio — a mesma
   * finalização que o envio direto faz ao terminar.
   */
  async finalizarDisparo(
    disparoId:  number,
    resultados: ResultadoGrupo[],
  ): Promise<{ enviados: number; falhas: number }> {
    const disparo = await this.disparos.getDisparo(disparoId);
    if (!disparo) throw new Error(`Disparo ${disparoId} não encontrado`);

    let enviados = 0;
    let falhas   = 0;

    for (const r of resultados) {
      if (r.status === 'ok') enviados += 1;
      else falhas += 1;

      await this.disparos.registrarLog({
        disparoId,
        grupoJid:  r.jid,
        grupoNome: r.nome ?? null,
        status:    r.status === 'ok' ? 'ok' : 'erro',
        erro:      r.erro ?? null,
      });
    }

    const agora = new Date();
    // Acabaram os produtos, acabou a campanha — mesmo antes da data de término.
    // Aqui o cursor já foi gravado por executarDisparo, então o banco sabe.
    const proximo = listaAcabou(disparo) ? null : calcularProximoEnvio(disparo, agora);

    await this.disparos.atualizarDisparo(disparoId, {
      status:       proximo ? 'agendado' : (falhas > 0 && enviados === 0 ? 'erro' : 'enviado'),
      ultimoEnvio:  agora,
      proximoEnvio: proximo,
    });

    logger.info({ disparoId, enviados, falhas, proximo }, 'Disparo finalizado (callback do campanhas)');
    return { enviados, falhas };
  }

  /**
   * Envio direto pela Evolution (fallback). Em cada grupo: manda a mensagem
   * como texto e, em seguida, cada criativo como imagem com a própria legenda —
   * que é como a oferta fica legível no grupo quando são vários produtos.
   * O grupo conta como enviado se ao menos uma peça chegou.
   */
  private async executarDisparoDireto(disparoId: number): Promise<{ enviados: number; falhas: number }> {
    const disparo = await this.disparos.getDisparo(disparoId);
    if (!disparo) throw new Error(`Disparo ${disparoId} não encontrado`);

    const instanceName = await this.resolverInstancia(disparo);

    await this.disparos.atualizarDisparo(disparoId, { status: 'enviando' });

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

    const rodizio = loteDaVez(disparo, midias);
    const envio = montarEnvio(disparo.mensagem, rodizio.lote);

    let enviados = 0;
    let falhas   = 0;

    for (const grupo of grupos) {
      const erros: string[] = [];
      let algoChegou = false;

      try {
        if (envio.texto) {
          const r = await this.enviarTextoGrupo(instanceName, grupo.jid, envio.texto);
          if (r.ok) algoChegou = true;
          else erros.push(`texto: ${JSON.stringify(r.data).slice(0, 200)}`);
          await sleep(DELAY_ENTRE_GRUPOS_MS());
        }

        for (const midia of envio.midias) {
          const r = await this.enviarMidiaGrupo(instanceName, grupo.jid, {
            media:    midia.b64,
            mimetype: midia.mime || 'image/png',
            caption:  midia.rotulo ?? '',
          });
          if (r.ok) algoChegou = true;
          else erros.push(`${midia.rotulo ?? 'imagem'}: ${JSON.stringify(r.data).slice(0, 200)}`);
          await sleep(DELAY_ENTRE_GRUPOS_MS());
        }
      } catch (err) {
        erros.push(err instanceof Error ? err.message : String(err));
      }

      if (algoChegou) {
        enviados += 1;
        await this.disparos.registrarLog({
          disparoId, grupoJid: grupo.jid, grupoNome: grupo.nome,
          status: 'ok',
          erro: erros.length ? `parcial — ${erros.join(' | ')}`.slice(0, 500) : null,
        });
      } else {
        falhas += 1;
        await this.disparos.registrarLog({
          disparoId, grupoJid: grupo.jid, grupoNome: grupo.nome,
          status: 'erro', erro: erros.join(' | ').slice(0, 500) || 'Nada foi enviado',
        });
      }
    }

    const agora = new Date();
    const proximo = rodizio.acabou ? null : calcularProximoEnvio(disparo, agora);

    await this.disparos.atualizarDisparo(disparoId, {
      status:       proximo ? 'agendado' : (falhas > 0 && enviados === 0 ? 'erro' : 'enviado'),
      ultimoEnvio:  agora,
      proximoEnvio: proximo,
      // Avança mesmo com falha parcial: repetir o mesmo lote na próxima
      // postagem atrasaria a lista inteira por causa de um grupo fora do ar.
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
  }

  // ── Criação do disparo ───────────────────────────────────────────────────

  /**
   * Cria o disparo e, se for para agora, executa na hora.
   * Reúne as validações que antes moravam na rota (ver histórico de
   * disparos/routes.ts) — inclusive a trava de grupo de outro cliente.
   */
  async criar(gestorId: number, b: CriarDisparoBody): Promise<ResultadoCriacaoDisparo> {
    const midias = Array.isArray(b.midias) ? b.midias.filter((m) => m?.b64) : [];

    // Só id e nome: o corpo do disparo já carrega dezenas de MB de imagem,
    // não é lugar para reboque. Nome vai junto para o histórico sobreviver
    // ao produto ser apagado do banco de imagens.
    const produtos = Array.isArray(b.produtos)
      ? b.produtos
          .filter((p) => Number.isInteger(p?.id) && p.id > 0)
          .map((p) => ({ id: p.id, nome: String(p.nome ?? '').slice(0, 200) }))
      : [];

    if (!b.mensagem?.trim() && midias.length === 0) {
      throw new RequisicaoInvalida('Informe a mensagem ou ao menos um criativo.');
    }
    if (!Array.isArray(b.grupos) || b.grupos.length === 0) {
      throw new RequisicaoInvalida('Selecione ao menos um grupo.');
    }

    const quando  = b.quando === 'agendado' ? 'agendado' : 'agora';
    const repetir = b.repetir ?? 'nunca';

    let agendadoPara: Date | null = null;
    if (quando === 'agendado') {
      if (!b.agendado_para) throw new RequisicaoInvalida('Informe a data e hora do agendamento.');
      agendadoPara = new Date(b.agendado_para);
      if (Number.isNaN(agendadoPara.getTime())) {
        throw new RequisicaoInvalida('Data de agendamento inválida.');
      }
    }

    /*
     * Por padrão, nada sai em sábado ou domingo (regra do dono, 11/09/2026).
     * O gestor pode LIBERAR o fim de semana, campanha a campanha, com o botão
     * da tela (`permitir_fim_de_semana`, migration 0044). Só `true` libera:
     * ausente, null ou qualquer outro valor mantém a trava.
     *
     * `calcularProximoEnvio` já pula o fim de semana nas repetições, mas o
     * PRIMEIRO envio é a data que o gestor digitou — sem esta trava, uma
     * campanha marcada para sábado postaria no sábado e só então passaria a
     * pular. O dia é medido no fuso do disparo, não no do servidor (a VPS
     * roda em UTC).
     */
    const permitirFimDeSemana = b.permitir_fim_de_semana === true;
    const fuso = b.timezone ?? 'America/Sao_Paulo';
    const quandoSai = agendadoPara ?? new Date();
    if (!permitirFimDeSemana && ehFimDeSemana(quandoSai, fuso)) {
      throw new RequisicaoInvalida(
        'Disparos não saem em sábado nem domingo. Escolha um dia útil ou libere o fim de semana nesta campanha.',
      );
    }

    // Conexão escolhida no passo 1 (opção b: a do gestor ou uma global).
    let instanceName: string | null = null;
    if (b.instance) {
      const permitidas = await this.instanciasPermitidas(gestorId);
      if (!permitidas.has(b.instance)) {
        throw new Proibido('Esta conexão não está disponível para você.');
      }
      instanceName = b.instance;
    } else {
      // Sem escolha explícita: usa a conexão do gestor, que precisa estar conectada.
      const status = await this.statusGestor(gestorId);
      if (!status.conectado) {
        throw new Conflito('Selecione uma conexão conectada antes de disparar.');
      }
    }

    // A solicitação precisa ser do próprio gestor — senão dava para marcar
    // como atendida o pedido de um cliente de outro gestor.
    let solicitacaoId: number | null = null;
    if (b.solicitacao_id) {
      const s = await this.solicitacoes.buscarPorId(Number(b.solicitacao_id));
      if (s && s.gestorId === gestorId) solicitacaoId = s.id;
    }

    // Horários fixos do dia. Guardamos só com 2 ou mais: com um só, quem
    // manda é o agendado_para e o comportamento é o de sempre.
    const horarios = Array.isArray(b.horarios)
      ? [...new Set(b.horarios.filter(horarioValido))].sort()
      : [];

    // Fim da repetição. Só faz sentido quando repete.
    let repetirAte: Date | null = null;
    if (repetir !== 'nunca' && b.repetir_ate) {
      const d = new Date(b.repetir_ate);
      if (Number.isNaN(d.getTime())) throw new RequisicaoInvalida('Data de término inválida.');
      if (agendadoPara && d.getTime() < agendadoPara.getTime()) {
        throw new RequisicaoInvalida('A data de término é anterior à de início.');
      }
      repetirAte = d;
    }

    /*
     * "Repetir os produtos": a lista dá a volta ao acabar (migration 0035).
     *
     * Só existe em disparo repetido — no envio único a lista vai inteira de
     * uma vez e não há volta a dar. E ele TROCA a condição de parada: sem
     * ele, a campanha acaba quando os produtos acabam; com ele, a data de
     * término é a única coisa que a encerra, então ela vira obrigatória.
     * Sem essa trava o gestor criaria uma campanha que não para nunca.
     */
    const repetirProdutos = repetir !== 'nunca' && b.repetir_produtos === true;
    if (repetirProdutos && !repetirAte) {
      throw new RequisicaoInvalida(
        'Com "repetir os produtos" ligado, a data de término é obrigatória — é ela que encerra a campanha.',
      );
    }

    /*
     * TRAVA DE SERVIDOR — grupo que pertence a outro cliente.
     *
     * INCIDENTE 29/08: disparos da farmácia 83 (Farma Fátima) foram gravados
     * com o grupo da farmácia 75 (Mais Saúde) e a oferta de um cliente caiu
     * no grupo do outro. O gestor afirma ter escolhido o grupo certo, e os
     * dados dão margem a ele: o erro "começa certo e depois gruda", que não
     * é a forma de um engano de clique. Não achei o vazamento no front.
     *
     * Por isso a checagem mora AQUI, e não só na tela: se o corpo chegar com
     * um grupo cujo histórico é de outra farmácia, a API recusa. Vale para
     * engano humano e para bug de estado que eu não encontrei — nenhum dos
     * dois passa. Para postar mesmo assim (grupo compartilhado, cliente que
     * mudou de dono), o front manda `confirmar_grupo_de_outro_cliente`.
     */
    const farmaciaEscolhida = b.farmacia_id ? Number(b.farmacia_id) : null;
    if (farmaciaEscolhida && !b.confirmar_grupo_de_outro_cliente) {
      const jids  = b.grupos.map((g) => g.jid).filter(Boolean);
      const donos = await this.disparos.donosDeGrupos(gestorId, jids);
      const alheios = donos.filter((d) => d.farmaciaId !== farmaciaEscolhida);

      if (alheios.length > 0) {
        const porGrupo = b.grupos
          .filter((g) => alheios.some((d) => d.jid === g.jid))
          .map((g) => ({
            jid:   g.jid,
            grupo: g.nome,
            donos: alheios
              .filter((d) => d.jid === g.jid)
              .map((d) => d.nomeFachada?.trim() || d.nome),
          }));

        logger.warn(
          { gestorId, farmaciaId: farmaciaEscolhida, porGrupo },
          'Disparo recusado: grupo pertence a outro cliente',
        );

        throw new ErroAplicacao(
          409,
          'Um dos grupos escolhidos tem campanha de outro cliente rodando agora. Confira o grupo antes de continuar.',
          {},
          { grupos_de_outro_cliente: porGrupo },
        );
      }
    }

    const disparo = await this.disparos.criarDisparo({
      gestorId,
      instanceName,
      titulo:        b.titulo?.trim() || 'Ofertas',
      mensagem:      b.mensagem ?? '',
      midiasJson:    midias.length ? JSON.stringify(midias) : null,
      produtosJson:  produtos.length ? JSON.stringify(produtos) : null,
      farmaciaId:    b.farmacia_id ? Number(b.farmacia_id) : null,
      solicitacaoId,
      gruposJson:   JSON.stringify(b.grupos),
      quando,
      agendadoPara,
      repetir,
      horariosJson: horarios.length > 1 ? JSON.stringify(horarios) : null,
      repetirAte,
      repetirProdutos,
      permitirFimDeSemana,
      timezone:     b.timezone ?? 'America/Sao_Paulo',
      status:       quando === 'agora' ? 'enviando' : 'agendado',
      proximoEnvio: quando === 'agora' ? null : agendadoPara,
    });

    if (quando === 'agora') {
      try {
        const resultado = await this.executarDisparo(disparo.id);
        if (solicitacaoId) await this.solicitacoes.atualizarStatus(solicitacaoId, 'atendida');

        if (resultado.modo === 'campanhas') {
          // Enfileirado no motor de campanhas — o resultado por grupo chega
          // depois via callback; aqui só confirmamos o aceite.
          return { tipo: 'enfileirado', id: disparo.id, totalGrupos: resultado.grupos };
        }
        return { tipo: 'enviado', id: disparo.id, enviados: resultado.enviados, falhas: resultado.falhas };
      } catch (err) {
        logger.error({ err, disparoId: disparo.id }, 'Erro ao executar disparo imediato');
        await this.disparos.atualizarDisparo(disparo.id, { status: 'erro' });
        const msg = err instanceof Error ? err.message : 'Erro ao disparar';
        throw new FalhaExterna(msg);
      }
    }

    /*
     * Campanha programada já fecha o pedido do cliente.
     *
     * Antes só o disparo imediato marcava 'atendida', e o caminho normal do
     * gestor é AGENDAR — então o cliente ficava verde na carteira para
     * sempre, como se a lista dele nunca tivesse sido montada. Quem foi
     * agendado sai do "aguardando" na hora; se a campanha for cancelada, o
     * cancelar() abaixo devolve o pedido para pendente.
     */
    if (solicitacaoId) await this.solicitacoes.atualizarStatus(solicitacaoId, 'atendida');

    return { tipo: 'agendado', id: disparo.id, agendadoPara, repetir };
  }

  // ── Consulta e cancelamento ──────────────────────────────────────────────

  async listar(gestorId: number): Promise<DisparoGrupo[]> {
    return this.disparos.listarDisparos(gestorId);
  }

  async ultimosProdutos(gestorId: number, farmaciaId: number) {
    return this.disparos.ultimosProdutosDaFarmacia(gestorId, farmaciaId);
  }

  private async exigirDoGestor(gestorId: number, id: number): Promise<DisparoGrupo> {
    const disparo = await this.disparos.getDisparo(id);
    if (!disparo) throw new NaoEncontrado('Disparo não encontrado');
    if (disparo.gestorId !== gestorId) throw new Proibido('Este disparo não pertence a você');
    return disparo;
  }

  async detalhar(gestorId: number, id: number): Promise<DisparoGrupo> {
    return this.exigirDoGestor(gestorId, id);
  }

  async logs(gestorId: number, id: number): Promise<DisparoGrupoLog[]> {
    const disparo = await this.exigirDoGestor(gestorId, id);
    return this.disparos.logsDoDisparo(disparo.id);
  }

  /** Cancela um agendamento. Devolve o pedido para a fila quando não sobra campanha viva. */
  async cancelar(gestorId: number, id: number): Promise<void> {
    const disparo = await this.exigirDoGestor(gestorId, id);

    await this.disparos.atualizarDisparo(disparo.id, { status: 'cancelado', proximoEnvio: null });

    // Campanha cancelada devolve o pedido para a fila: a lista do cliente
    // continua de pé e ele tem de voltar a aparecer como "respondeu". Só
    // quando não sobrou nenhuma outra campanha viva daquele mesmo pedido.
    if (disparo.solicitacaoId) {
      const aindaTemCampanha = await this.disparos.temDisparoAtivoDaSolicitacao(disparo.solicitacaoId);
      if (!aindaTemCampanha) {
        await this.solicitacoes.atualizarStatus(disparo.solicitacaoId, 'pendente');
      }
    }
  }
}
