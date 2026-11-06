import { logger } from './logger';
// Instâncias compartilhadas até este scheduler virar classe e receber pelo construtor.
import {
  whatsappService, whatsappRepository, disparoService, disparoRepository, custoResultadoService,
} from './composicao';

const INTERVALO_MS = 60_000; // verifica a cada 1 minuto

// ── Formatação ────────────────────────────────────────────────────────────────

function formatarDataHoraBR(data: Date): { data: string; hora: string } {
  const opts: Intl.DateTimeFormatOptions = { timeZone: 'America/Sao_Paulo' };
  return {
    data: data.toLocaleDateString('pt-BR',  { ...opts, day: '2-digit', month: '2-digit', year: 'numeric' }),
    hora: data.toLocaleTimeString('pt-BR',  { ...opts, hour: '2-digit', minute: '2-digit' }),
  };
}

function montarMensagem(params: {
  responsavel: string | null;
  farmacia:    string;
  titulo:      string;
  dataReuniao: Date;
  duracao:     number;
  linkMeet:    string | null;
  local:       string | null;
}): string {
  const { responsavel, farmacia, titulo, dataReuniao, duracao, linkMeet, local } = params;
  const { data, hora } = formatarDataHoraBR(dataReuniao);

  const linhas = [
    responsavel ? `Olá, *${responsavel}*!` : 'Olá!',
    '',
    `Lembrando que em *5 horas* temos nossa reunião agendada:`,
    '',
    `📋 *${titulo}*`,
    `🏥 ${farmacia}`,
    `📅 ${data} às ${hora}`,
    `⏱️ Duração: ${duracao} min`,
  ];

  if (local)    linhas.push(`📍 Local: ${local}`);
  if (linkMeet) linhas.push(`🔗 Link: ${linkMeet}`);

  linhas.push('', 'Por favor, confirme sua presença. Até logo! 😊');
  return linhas.join('\n');
}

// ── Verificação ───────────────────────────────────────────────────────────────

async function verificarENotificar(): Promise<void> {
  const reunioes = await whatsappRepository.buscarReunioesPara5h();
  if (!reunioes.length) return;

  logger.info({ total: reunioes.length }, 'Scheduler: reuniões para notificar via WhatsApp');

  for (const row of reunioes) {
    const id          = Number(row.id);
    const telefone    = String(row.telefone);
    const dataReuniao = new Date(String(row.data_reuniao));

    const mensagem = montarMensagem({
      responsavel: null,
      farmacia:    String(row.farmacia_nome),
      titulo:      String(row.titulo),
      dataReuniao,
      duracao:     Number(row.duracao_minutos ?? 60),
      linkMeet:    row.link_meet ? String(row.link_meet) : null,
      local:       row.local     ? String(row.local)     : null,
    });

    const enviado = await whatsappService.enviarMensagem(telefone, mensagem);

    if (enviado) {
      await whatsappRepository.marcarNotificacaoEnviada(id);
      logger.info({ reuniaoId: id, telefone }, 'Notificação WhatsApp enviada e registrada');
    }
  }
}

// ── Aviso 5 minutos antes ─────────────────────────────────────────────────────

function montarAviso5min(params: { titulo: string; dataReuniao: Date }): string {
  const { titulo, dataReuniao } = params;
  const { hora } = formatarDataHoraBR(dataReuniao);

  return [
    'Olá! ⏰',
    '',
    `Nossa reunião começa em *5 minutos* (às ${hora}):`,
    '',
    `📋 *${titulo}*`,
    '',
    'Até já! 😊',
  ].join('\n');
}

/** Conexão (tela Conexões) que envia o aviso de 5 minutos — casa pelo nome ou pela instância. */
const CONEXAO_AVISO_5MIN = 'KAIO';

async function instanciaDoAviso5min(): Promise<string | null> {
  const alvo = CONEXAO_AVISO_5MIN.toLowerCase();
  const configs = await whatsappRepository.listConfigs();
  const config = configs.find(c =>
    (c.nome ?? '').trim().toLowerCase() === alvo || c.instanceName.trim().toLowerCase() === alvo,
  );
  return config?.instanceName ?? null;
}

async function verificarEAvisar5min(): Promise<void> {
  const reunioes = await whatsappRepository.buscarReunioesPara5min();
  if (!reunioes.length) return;

  // Sem a conexão KAIO não envia por outra: o aviso fica pendente e tenta no próximo minuto
  const instancia = await instanciaDoAviso5min();
  if (!instancia) {
    logger.warn({ conexao: CONEXAO_AVISO_5MIN }, 'Conexão do aviso de 5 minutos não encontrada — aviso não enviado');
    return;
  }

  logger.info({ total: reunioes.length }, 'Scheduler: reuniões começando em 5 minutos');

  for (const row of reunioes) {
    const id       = Number(row.id);
    const telefone = String(row.telefone);

    const mensagem = montarAviso5min({
      titulo:      String(row.titulo),
      dataReuniao: new Date(String(row.data_reuniao)),
    });

    const enviado = await whatsappService.enviarMensagem(telefone, mensagem, instancia);

    if (enviado) {
      await whatsappRepository.marcarAviso5minEnviado(id);
      logger.info({ reuniaoId: id, telefone }, 'Aviso de 5 minutos enviado e registrado');
    }
  }
}

// ── Disparos agendados em grupos ──────────────────────────────────────────────

/**
 * Executa os disparos de grupo cuja hora chegou. O próprio executarDisparo
 * recalcula o proximo_envio conforme a repetição (ou finaliza o disparo).
 */
async function verificarDisparosAgendados(): Promise<void> {
  const pendentes = await disparoRepository.buscarDisparosPendentes(new Date());
  if (!pendentes.length) return;

  logger.info({ total: pendentes.length }, 'Scheduler: disparos de grupo pendentes');

  for (const disparo of pendentes) {
    try {
      const resultado = await disparoService.executarDisparo(disparo.id);
      logger.info(
        { disparoId: disparo.id, resultado },
        'Scheduler: disparo em grupos processado',
      );
    } catch (err) {
      logger.error({ err, disparoId: disparo.id }, 'Erro ao executar disparo agendado');
      await disparoRepository.atualizarDisparo(disparo.id, { status: 'erro' });
    }
  }
}

/**
 * Um disparo entra em "enviando" e só sai de lá quando termina (ou quando o
 * callback do motor de campanhas chega). Se a API cair no meio, ou o callback
 * se perder, ele fica "enviando" para sempre e ninguém descobre que a oferta
 * não foi ao ar. Aqui marcamos esses como erro para aparecerem no Histórico.
 *
 * Não reenviamos sozinhos de propósito: parte das mensagens pode ter saído, e
 * repetir a oferta no grupo do cliente é pior do que avisar o gestor.
 */
const LIMITE_ENVIANDO_MS = 30 * 60 * 1000;

async function verificarDisparosTravados(): Promise<void> {
  const limite = new Date(Date.now() - LIMITE_ENVIANDO_MS);
  const travados = await disparoRepository.buscarDisparosTravados(limite);
  if (!travados.length) return;

  for (const disparo of travados) {
    logger.error(
      { disparoId: disparo.id, desde: disparo.atualizadoEm },
      'Disparo preso em "enviando" — marcando como erro',
    );
    await disparoRepository.atualizarDisparo(disparo.id, { status: 'erro' });
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────

export function iniciarSchedulerWhatsApp(): void {
  logger.info('Scheduler WhatsApp iniciado — verificação a cada 1 minuto');

  setInterval(() => {
    verificarENotificar().catch(err =>
      logger.error({ err }, 'Erro no scheduler de notificações WhatsApp'),
    );

    verificarEAvisar5min().catch(err =>
      logger.error({ err }, 'Erro no scheduler do aviso de 5 minutos'),
    );

    verificarDisparosAgendados().catch(err =>
      logger.error({ err }, 'Erro no scheduler de disparos em grupos'),
    );

    verificarDisparosTravados().catch(err =>
      logger.error({ err }, 'Erro ao verificar disparos travados'),
    );

    // Custo por resultado do Meta: uma rodada por dia, a partir das 06:00 (Brasília)
    custoResultadoService.rodarSeForAHora().catch(err =>
      logger.error({ err }, 'Erro no job de custo por resultado do Meta'),
    );
  }, INTERVALO_MS);
}
