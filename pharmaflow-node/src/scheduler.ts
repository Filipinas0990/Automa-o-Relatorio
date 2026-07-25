import { whatsappService }    from './whatsapp/service';
import { whatsappRepository } from './whatsapp/repository';
import { disparosService }    from './disparos/service';
import { disparosRepository } from './disparos/repository';
import { logger }             from './logger';

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

// ── Disparos agendados em grupos ──────────────────────────────────────────────

/**
 * Executa os disparos de grupo cuja hora chegou. O próprio executarDisparo
 * recalcula o proximo_envio conforme a repetição (ou finaliza o disparo).
 */
async function verificarDisparosAgendados(): Promise<void> {
  const pendentes = await disparosRepository.buscarDisparosPendentes(new Date());
  if (!pendentes.length) return;

  logger.info({ total: pendentes.length }, 'Scheduler: disparos de grupo pendentes');

  for (const disparo of pendentes) {
    try {
      const { enviados, falhas } = await disparosService.executarDisparo(disparo.id);
      logger.info(
        { disparoId: disparo.id, enviados, falhas },
        'Scheduler: disparo em grupos concluído',
      );
    } catch (err) {
      logger.error({ err, disparoId: disparo.id }, 'Erro ao executar disparo agendado');
      await disparosRepository.atualizarDisparo(disparo.id, { status: 'erro' });
    }
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────

export function iniciarSchedulerWhatsApp(): void {
  logger.info('Scheduler WhatsApp iniciado — verificação a cada 1 minuto');

  setInterval(() => {
    verificarENotificar().catch(err =>
      logger.error({ err }, 'Erro no scheduler de notificações WhatsApp'),
    );

    verificarDisparosAgendados().catch(err =>
      logger.error({ err }, 'Erro no scheduler de disparos em grupos'),
    );
  }, INTERVALO_MS);
}
