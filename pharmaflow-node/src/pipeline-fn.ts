import 'dotenv/config';
import { logger } from './logger';
import { emitPipelineLog } from './log-stream';
import { eq, and, isNotNull, desc } from 'drizzle-orm';
import { db }                        from './database/db';
import { farmacias, coletas, coletaCanais } from './database/schema';
import { coletarTodas }              from './scraper/pharmachatbot';
import { calcularScore }             from './processor/score';
import { decrypt }                   from './cripto';
import type { DadosFarmacia, FarmaciaParaColeta } from './types';

async function carregarFarmacias(gestorId?: number): Promise<(FarmaciaParaColeta & { dias?: number })[]> {
  const rows = await db.select().from(farmacias).where(
    and(
      eq(farmacias.ativa, true),
      eq(farmacias.temChatbot, true),   // pula farmácias sem chatbot
      isNotNull(farmacias.senhaEnc),
      ...(gestorId ? [eq(farmacias.gestorId, gestorId)] : []),
    )
  );
  return rows.map(f => {
    let senha = '';
    try { if (f.senhaEnc) senha = decrypt(f.senhaEnc); } catch { /* sem senha */ }
    return {
      id: f.id, nome: f.nome,
      urlBase: f.urlBase ?? '',   // sempre não-null para farmácias com chatbot
      email:   f.email   ?? '',
      senha,
      metaLeadsGoogle: f.metaLeadsGoogle ?? null,
      metaLeadsMeta:   f.metaLeadsMeta   ?? null,
    };
  });
}

export interface PipelineOpcoes {
  periodos?: number[];  // default [7, 15, 30]
  gestorId?: number;    // default: todas as farmácias
}

export interface FarmaciaErro {
  nome:    string;
  periodo: number;
  erro:    string;
}

export interface PipelineResultado {
  totalSucessos:    number;
  totalErros:       number;
  farmaciasTotais:  number;
  farmaciasComErro: FarmaciaErro[];
}

// Retorna quantas farmácias seriam coletadas sem disparar nada
export async function previewPipeline(opcoes: PipelineOpcoes = {}): Promise<{ farmaciasTotais: number; nomes: string[]; periodos: number[] }> {
  const periodos = opcoes.periodos?.length ? opcoes.periodos : [7, 15, 30];
  const farms = await carregarFarmacias(opcoes.gestorId);
  return { farmaciasTotais: farms.length, nomes: farms.map(f => f.nome), periodos };
}

async function coletaAnterior(farmaciaId: number, periodoDias: number) {
  const [ant] = await db.select().from(coletas)
    .where(and(eq(coletas.farmaciaId, farmaciaId), eq(coletas.periodoDias, periodoDias)))
    .orderBy(desc(coletas.dataColeta))
    .limit(1);
  return ant ?? null;
}

async function salvarResultados(dadosColetados: DadosFarmacia[], periodoDias: number): Promise<void> {
  for (const dado of dadosColetados) {
    if (dado.erro) {
      logger.error({ farmacia: dado.nome, erro: dado.erro }, 'Coleta falhou');
      emitPipelineLog('error', `❌ ${dado.nome} (${periodoDias}d) — ${dado.erro}`, { farmacia: dado.nome, periodo: periodoDias });
      continue;
    }

    const [farmacia] = await db.select().from(farmacias).where(
      and(eq(farmacias.nome, dado.nome), eq(farmacias.ativa, true))
    );
    if (!farmacia) { logger.warn({ farmacia: dado.nome }, 'Farmácia não encontrada no banco'); continue; }

    const anterior = await coletaAnterior(farmacia.id, periodoDias);
    const metricasAnterior = anterior ? {
      clientesGoogle:       anterior.clientesGoogle       ?? 0,
      clientesFacebook:     anterior.clientesFacebook     ?? 0,
      clientesGruposOferta: anterior.clientesGruposOferta ?? 0,
      vendasRealizadas:     anterior.vendasRealizadas     ?? 0,
      receitaTotal:         parseFloat(anterior.receitaTotal ?? '0'),
    } : null;

    const scoreInfo = calcularScore(
      {
        clientesGoogle:       dado.clientesGoogle,
        clientesFacebook:     dado.clientesFacebook,
        clientesGruposOferta: dado.clientesGruposOferta,
        vendasRealizadas:     dado.vendasRealizadas,
        receitaTotal:         dado.receitaTotal,
      },
      metricasAnterior
    );

    const metaR = farmacia.metaReceita ? parseFloat(farmacia.metaReceita) : null;
    const atingiuMeta = metaR !== null ? dado.receitaTotal >= metaR : false;
    if (metaR !== null && !atingiuMeta) {
      scoreInfo.nivelAlerta = 'vermelho';
      if (scoreInfo.scoreCriticidade < 50) scoreInfo.scoreCriticidade = 50;
      scoreInfo.alertas.push('Meta semanal não atingida');
    }

    // Metas de leads por canal — só conta se meta > 0 (meta = 0 é considerada "sem meta")
    const atingiuMetaGoogle = (farmacia.metaLeadsGoogle !== null && farmacia.metaLeadsGoogle > 0)
      ? dado.clientesGoogle >= farmacia.metaLeadsGoogle
      : null;
    const atingiuMetaMeta = (farmacia.metaLeadsMeta !== null && farmacia.metaLeadsMeta > 0)
      ? dado.clientesFacebook >= farmacia.metaLeadsMeta
      : null;

    const [coleta] = await db.insert(coletas).values({
      farmaciaId:           farmacia.id,
      periodoInicio:        dado.periodoInicio,
      periodoFim:           dado.periodoFim,
      periodoDias,
      clientesGoogle:       dado.clientesGoogle,
      clientesFacebook:     dado.clientesFacebook,
      clientesGruposOferta: dado.clientesGruposOferta,
      totalAtendimentos:    dado.totalAtendimentos,
      vendasRealizadas:     dado.vendasRealizadas,
      receitaTotal:         String(dado.receitaTotal),
      scoreCriticidade:     String(scoreInfo.scoreCriticidade),
      nivelAlerta:          scoreInfo.nivelAlerta,
      variacaoGoogle:       String(scoreInfo.variacaoGoogle),
      variacaoFacebook:     String(scoreInfo.variacaoFacebook),
      variacaoGrupos:       String(scoreInfo.variacaoGrupos),
      variacaoVendas:       String(scoreInfo.variacaoVendas),
      variacaoReceita:      String(scoreInfo.variacaoReceita),
      atingiuMeta,
      atingiuMetaGoogle,
      atingiuMetaMeta,
    }).returning({ id: coletas.id });

    const vendasPorCanal: Record<string, { vendas: number; receita: number }> = {};
    for (const [k, v] of Object.entries(dado.canaisVendas || {})) {
      vendasPorCanal[k.trim().toLowerCase()] = v;
    }
    function matchCanal(nomePizza: string): { vendas?: number; receita?: number } {
      const chave = nomePizza.trim().toLowerCase();
      if (vendasPorCanal[chave]) return vendasPorCanal[chave];
      for (const [k, v] of Object.entries(vendasPorCanal)) {
        if (k.split(' ').some(t => t.length > 3 && chave.includes(t))) return v;
      }
      return {};
    }

    // Salva apenas os canais do gráfico de pizza (canais reais de marketing)
    // canaisVendas é usado apenas para enriquecer com dados de vendas/receita
    for (const [nome, totalAtend] of Object.entries(dado.canais || {})) {
      const info = matchCanal(nome);
      await db.insert(coletaCanais).values({
        coletaId:      coleta.id,
        canal:         nome,
        atendimentos:  totalAtend,
        vendas:        info.vendas  || 0,
        receitaVendas: String(info.receita || 0),
      });
    }

    const alertaIcon = { verde: '🟢', amarelo: '🟡', vermelho: '🔴' }[scoreInfo.nivelAlerta] ?? '⚪';
    logger.info({
      farmacia:    dado.nome,
      nivelAlerta: scoreInfo.nivelAlerta,
      score:       scoreInfo.scoreCriticidade,
      alertas:     scoreInfo.alertas,
      atingiuMeta,
      receita:     dado.receitaTotal,
      vendas:      dado.vendasRealizadas,
    }, 'Coleta salva');
    emitPipelineLog('info',
      `${alertaIcon} ${dado.nome} (${periodoDias}d) — R$ ${dado.receitaTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} | ${dado.vendasRealizadas} vendas`,
      { farmacia: dado.nome, periodo: periodoDias, nivelAlerta: scoreInfo.nivelAlerta, receita: dado.receitaTotal, vendas: dado.vendasRealizadas }
    );
  }
}

export async function pipeline(opcoes: PipelineOpcoes = {}): Promise<PipelineResultado> {
  const periodos    = opcoes.periodos?.length ? opcoes.periodos : [7, 15, 30];
  const farmsAtivas = await carregarFarmacias(opcoes.gestorId);

  logger.info({ total: farmsAtivas.length, periodos, gestorId: opcoes.gestorId }, 'Pipeline iniciado');
  emitPipelineLog('info', `🚀 Pipeline iniciado — ${farmsAtivas.length} farmácias | períodos: ${periodos.join(', ')}d`, { total: farmsAtivas.length, periodos });

  const paralelo     = parseInt(process.env.PARALELO_MAX   || '1',     10);
  const retryMax     = parseInt(process.env.RETRY_MAX      || '2',     10);
  const retryDelayMs = parseInt(process.env.RETRY_DELAY_MS || '60000', 10);

  let totalSucessos    = 0;
  let totalErros       = 0;
  const farmaciasComErro: FarmaciaErro[] = [];

  for (const dias of periodos) {
    logger.info({ dias }, `Coletando período de ${dias} dias`);
    emitPipelineLog('info', `📅 Iniciando período de ${dias} dias (${farmsAtivas.length} farmácias)`, { dias, total: farmsAtivas.length });
    const farmsComPeriodo = farmsAtivas.map(f => ({ ...f, dias }));
    const resultados = await coletarTodas(farmsComPeriodo, paralelo);
    await salvarResultados(resultados, dias);

    const errosIniciais = resultados.filter(r => r.erro);
    let periodSucessos  = resultados.length - errosIniciais.length;

    // Retry automático para farmácias que falharam (ex: timeout ou bot detection)
    let pendentes = errosIniciais
      .map(r => farmsComPeriodo.find(f => f.nome === r.nome))
      .filter((f): f is typeof farmsComPeriodo[0] => !!f);

    // Guarda os últimos resultados de retry para recuperar a mensagem de erro final
    let ultimosResultados = resultados;

    for (let tentativa = 1; tentativa <= retryMax && pendentes.length > 0; tentativa++) {
      logger.warn(
        { dias, tentativa, retryMax, farms: pendentes.map(f => f.nome), aguardandoMs: retryDelayMs },
        `Retry ${tentativa}/${retryMax}: aguardando ${retryDelayMs / 1000}s antes de tentar novamente`
      );
      emitPipelineLog('warn',
        `🔄 Retry ${tentativa}/${retryMax}: ${pendentes.length} farmácias falharam — aguardando ${retryDelayMs / 1000}s`,
        { tentativa, retryMax, farms: pendentes.map(f => f.nome) }
      );
      await new Promise(resolve => setTimeout(resolve, retryDelayMs));

      const retryResultados = await coletarTodas(pendentes, paralelo);
      await salvarResultados(retryResultados, dias);
      ultimosResultados = retryResultados;

      const aindaErros = retryResultados.filter(r => r.erro);
      periodSucessos  += retryResultados.length - aindaErros.length;

      logger.info(
        { dias, tentativa, novosSucessos: retryResultados.length - aindaErros.length, aindaErros: aindaErros.length },
        `Retry ${tentativa}/${retryMax} concluído`
      );

      pendentes = aindaErros
        .map(r => pendentes.find(f => f.nome === r.nome))
        .filter((f): f is typeof farmsComPeriodo[0] => !!f);
    }

    // Registra as farmácias que falharam definitivamente neste período
    for (const f of pendentes) {
      const resultado = ultimosResultados.find(r => r.nome === f.nome);
      farmaciasComErro.push({ nome: f.nome, periodo: dias, erro: resultado?.erro ?? 'Erro desconhecido' });
    }

    totalSucessos += periodSucessos;
    totalErros    += pendentes.length;
    logger.info({ dias, sucessos: periodSucessos, erros: pendentes.length }, `Período ${dias}d concluído`);
    emitPipelineLog('info',
      `✅ Período ${dias}d concluído — ${periodSucessos} OK${pendentes.length > 0 ? ` | ${pendentes.length} com erro` : ''}`,
      { dias, sucessos: periodSucessos, erros: pendentes.length }
    );
  }

  logger.info({ totalSucessos, totalErros, farmaciasComErro }, 'Pipeline concluído');
  emitPipelineLog('info',
    `🏁 Pipeline concluído — ${totalSucessos}/${farmsAtivas.length * periodos.length} coletas OK${totalErros > 0 ? ` | ${totalErros} erros definitivos` : ''}`,
    { totalSucessos, totalErros, farmaciasTotais: farmsAtivas.length }
  );
  return { totalSucessos, totalErros, farmaciasTotais: farmsAtivas.length, farmaciasComErro };
}
