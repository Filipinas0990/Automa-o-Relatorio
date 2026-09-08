/**
 * Orquestrador principal do fluxo de automação de anúncios.
 * Funciona tanto via WhatsApp (reply = enviarMensagem) quanto via Web (reply = coleta em array).
 */

import { ilike, eq } from 'drizzle-orm';
import { db } from '../database/db';
import { gestoresTrafego, farmacias } from '../database/schema';
import { interpretarMensagem } from '../ai/interpretar';
import type { HistoricoMensagem } from '../ai/interpretar';
import { uploadImagem, criarAdCreative } from '../meta/criativo';
import { criarCampanhaCompleta } from '../meta/campanha';
import { listarContasDeAnuncio, type ContaAnuncio } from '../meta/client';
import { whatsappService } from '../whatsapp/service';
import { logger } from '../logger';
import {
  getTokenPorFarmacia,
  criarCampanhaPendente,
  getCampanhaPendente,
  getCampanhasPorGestor,
  atualizarStatusCampanha,
  listarClientesComToken,
} from './repository';
import type { CampanhaExtraida } from '../ai/types';

type ReplyFn = (text: string) => Promise<void>;

// ── Histórico de conversa por sessão (em memória) ─────────────────────────────

interface SessaoHistorico {
  mensagens: HistoricoMensagem[];
  imagemBase64?: string;   // guarda a última imagem enviada na conversa
  ultimaAtividade: number;
}

const sessoes = new Map<string, SessaoHistorico>();

// Limpa sessões inativas há mais de 30 minutos
setInterval(() => {
  const limite = Date.now() - 30 * 60 * 1000;
  for (const [id, sessao] of sessoes) {
    if (sessao.ultimaAtividade < limite) sessoes.delete(id);
  }
}, 5 * 60 * 1000);

function getSessao(identificador: string): SessaoHistorico {
  if (!sessoes.has(identificador)) {
    sessoes.set(identificador, { mensagens: [], ultimaAtividade: Date.now() });
  }
  return sessoes.get(identificador)!;
}

function getHistorico(identificador: string): HistoricoMensagem[] {
  return sessoes.get(identificador)?.mensagens ?? [];
}

function adicionarAoHistorico(identificador: string, role: 'user' | 'assistant', content: string) {
  const sessao = getSessao(identificador);
  if (sessao.mensagens.length >= 20) sessao.mensagens.splice(0, 2);
  sessao.mensagens.push({ role, content });
  sessao.ultimaAtividade = Date.now();
}

function salvarImagemNaSessao(identificador: string, imagemBase64: string) {
  const sessao = getSessao(identificador);
  sessao.imagemBase64 = imagemBase64;
  sessao.ultimaAtividade = Date.now();
}

function getImagemDaSessao(identificador: string): string | undefined {
  return sessoes.get(identificador)?.imagemBase64;
}

function limparHistorico(identificador: string) {
  sessoes.delete(identificador);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getFarmaciaPorNome(nome: string) {
  const [farmacia] = await db
    .select({ id: farmacias.id, nome: farmacias.nome })
    .from(farmacias)
    .where(ilike(farmacias.nome, `%${nome}%`))
    .limit(1);
  return farmacia ?? null;
}

function formatarResumo(c: CampanhaExtraida): string {
  const brl = (v: number | null) =>
    v != null ? `R$ ${(v / 100).toFixed(2).replace('.', ',')}` : '—';

  return (
    `✅ Entendido! Vou criar a campanha com os seguintes dados:\n\n` +
    `👤 Cliente: ${c.clienteNome ?? '—'}\n` +
    `🎯 Objetivo: ${c.objetivo ?? '—'}\n` +
    `💰 Budget diário: ${brl(c.orcamentoDiario)}\n` +
    `👥 Público: ${c.publico.genero === 'ALL' ? 'Todos' : (c.publico.genero ?? 'Todos')}, ` +
    `${c.publico.idadeMin ?? 18}–${c.publico.idadeMax ?? 65} anos\n` +
    `📍 Local: ${c.publico.localizacao ?? 'Não especificado'}\n` +
    `📅 Início: ${c.dataInicio ?? '—'} | Fim: ${c.dataFim ?? 'Sem prazo'}\n` +
    `📝 Copy: ${c.copy ?? '—'}\n` +
    `🖼️ Criativo: ${c.temMidia ? 'Imagem recebida ✓' : 'Nenhuma imagem'}\n\n` +
    `Confirma para publicar? Responda *SIM* ou faça correções.`
  );
}

// ── Cache das contas de anúncio ───────────────────────────────────────────────
//
// /me/adaccounts com business{name} e funding_source_details leva ~15s numa
// conta com muitas contas de anúncio (System User do BM enxerga dezenas) —
// mesma classe de problema que o cache de grupos (migration 0020): sem cache,
// o gestor paga essa espera toda vez que abre o passo 1 do wizard de campanha.
// Só existe UM token global (META_ACCESS_TOKEN), então basta uma cache global
// em memória — não precisa de tabela como a de grupos, que é por instância.

/** Depois disso o cache é servido, mas já pede refresh em background. */
const TTL_CONTAS_MS = 10 * 60 * 1000;

let cacheContas: { contas: ContaAnuncio[]; atualizadoEm: number } | null = null;
let syncContasEmVoo: Promise<ContaAnuncio[]> | null = null;

/** Busca na Meta e regrava o cache. Compartilha a chamada em voo entre pedidos concorrentes. */
function sincronizarContas(token: string): Promise<ContaAnuncio[]> {
  if (syncContasEmVoo) return syncContasEmVoo;

  syncContasEmVoo = listarContasDeAnuncio(token)
    .then((contas) => {
      cacheContas = { contas, atualizadoEm: Date.now() };
      return contas;
    })
    .finally(() => { syncContasEmVoo = null; });

  return syncContasEmVoo;
}

// ── Lógica interna (canal-agnóstica) ──────────────────────────────────────────

async function processarInterno(
  identificador: string,
  texto:         string,
  imagemBase64:  string | undefined,
  reply:         ReplyFn,
): Promise<void> {
  const historico = getHistorico(identificador);

  // Guarda imagem na sessão se foi enviada — vai ser usada quando a campanha for confirmada
  if (imagemBase64) salvarImagemNaSessao(identificador, imagemBase64);

  adicionarAoHistorico(identificador, 'user', texto || '(imagem enviada)');

  let interpretado;
  try {
    interpretado = await interpretarMensagem(texto, imagemBase64, historico.slice(0, -1));
  } catch (err) {
    logger.error({ err, identificador }, 'Erro ao interpretar mensagem com GPT');
    await reply('⚠️ Não consegui interpretar sua mensagem. Tente novamente.');
    return;
  }

  logger.info({ identificador, tipo: interpretado.tipo }, 'Mensagem interpretada');

  if (interpretado.tipo === 'confirmacao') {
    await confirmarInterno(identificador, reply);
    return;
  }

  if (interpretado.tipo === 'cancelamento') {
    const pendente = await getCampanhaPendente(identificador);
    if (pendente) {
      await atualizarStatusCampanha(pendente.id, 'cancelada');
      limparHistorico(identificador);
      await reply('❌ Campanha cancelada.');
    } else {
      await reply('⚠️ Nenhuma campanha aguardando cancelamento.');
    }
    return;
  }

  if (interpretado.tipo === 'listagem_clientes') {
    const clientes = await listarClientesComToken();
    if (clientes.length === 0) {
      const msg = '⚠️ Nenhum cliente com Meta Ads configurado ainda. Peça ao administrador para cadastrar.';
      adicionarAoHistorico(identificador, 'assistant', msg);
      await reply(msg);
    } else {
      const lista = clientes.map((c, i) => `${i + 1}. ${c.nome}`).join('\n');
      const msg = `📋 *Clientes disponíveis para criar campanha (${clientes.length}):*\n\n${lista}\n\nQual cliente deseja anunciar?`;
      adicionarAoHistorico(identificador, 'assistant', msg);
      await reply(msg);
    }
    return;
  }

  if (interpretado.tipo === 'campanha') {
    const campanha = interpretado.campanha;

    if (!campanha || campanha.camposFaltando.length > 0) {
      adicionarAoHistorico(identificador, 'assistant', interpretado.respostaSugerida);
      await reply(interpretado.respostaSugerida);
      return;
    }

    // Usa imagem da mensagem atual ou da sessão (enviada em mensagem anterior)
    const imagem = imagemBase64 ?? getImagemDaSessao(identificador);
    await iniciarInterno(identificador, campanha, imagem, reply);
    return;
  }

  if (interpretado.respostaSugerida) {
    adicionarAoHistorico(identificador, 'assistant', interpretado.respostaSugerida);
    await reply(interpretado.respostaSugerida);
  }
}

async function iniciarInterno(
  identificador: string,
  campanha:      CampanhaExtraida,
  imagemBase64:  string | undefined,
  reply:         ReplyFn,
): Promise<void> {
  if (!campanha.clienteNome) {
    const msg = '⚠️ Não identifiquei o nome do cliente. Por favor, informe qual cliente é.';
    adicionarAoHistorico(identificador, 'assistant', msg);
    await reply(msg);
    return;
  }

  const farmacia = await getFarmaciaPorNome(campanha.clienteNome);
  if (!farmacia) {
    const msg = `⚠️ Cliente *${campanha.clienteNome}* não encontrado no sistema. Verifique o nome.`;
    adicionarAoHistorico(identificador, 'assistant', msg);
    await reply(msg);
    return;
  }

  const token = await getTokenPorFarmacia(farmacia.id);
  if (!token) {
    const msg = `⚠️ Token Meta Ads não configurado para *${farmacia.nome}*. Peça ao administrador para cadastrar.`;
    adicionarAoHistorico(identificador, 'assistant', msg);
    await reply(msg);
    return;
  }

  await criarCampanhaPendente({
    farmaciaId:     farmacia.id,
    gestorTelefone: identificador,
    payloadJson:    campanha,
    imagemBase64,
  });

  // Limpa imagem da sessão — já foi salva no banco, não deve ser reutilizada
  const sessao = sessoes.get(identificador);
  if (sessao) sessao.imagemBase64 = undefined;

  const resumo = formatarResumo(campanha);
  adicionarAoHistorico(identificador, 'assistant', resumo);
  await reply(resumo);
}

async function confirmarInterno(identificador: string, reply: ReplyFn): Promise<void> {
  const pendente = await getCampanhaPendente(identificador);
  if (!pendente) {
    await reply('⚠️ Nenhuma campanha aguardando confirmação.');
    return;
  }

  const campanha = JSON.parse(pendente.payloadJson as string) as CampanhaExtraida;
  const token    = await getTokenPorFarmacia(pendente.farmaciaId);

  if (!token) {
    await reply('⚠️ Token Meta Ads não configurado. Contate o administrador.');
    return;
  }

  try {
    let creativeId: string | undefined;
    if (pendente.imagemBase64) {
      const img      = await uploadImagem(token, pendente.imagemBase64, 'criativo.jpg');
      const creative = await criarAdCreative(
        token,
        img.hash,
        campanha.copy ?? '',
        `https://www.facebook.com/${token.pageId}`,
      );
      creativeId = creative.id;
    }

    const resultado = await criarCampanhaCompleta({
      token,
      nome:            `${campanha.clienteNome} — ${new Date().toLocaleDateString('pt-BR')}`,
      objetivo:        campanha.objetivo        ?? 'LINK_CLICKS',
      orcamentoDiario: campanha.orcamentoDiario ?? 5000,
      dataInicio:      campanha.dataInicio       ?? new Date().toISOString().slice(0, 10),
      dataFim:         campanha.dataFim          ?? new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
      publico: {
        genero:      campanha.publico.genero      ?? 'ALL',
        idadeMin:    campanha.publico.idadeMin     ?? 18,
        idadeMax:    campanha.publico.idadeMax     ?? 65,
        // Fluxo do WhatsApp extrai a localização como texto livre (IA), e não
        // tem como virar a "key" que o Meta exige — cai no Brasil inteiro.
        localizacao: null,
        raioKm:      10,
      },
      copy:       campanha.copy ?? '',
      imagemHash: creativeId,
    });

    await atualizarStatusCampanha(pendente.id, 'publicada', resultado);
    limparHistorico(identificador);

    await reply(
      `🎯 *Campanha criada com sucesso!*\n\n` +
      `📋 ID: ${resultado.campanhaId}\n` +
      `👤 Cliente: ${campanha.clienteNome}\n` +
      `⏸️ Status: Pausada (revise antes de ativar)\n\n` +
      `👉 ${resultado.linkGerenciador}`,
    );
  } catch (err) {
    logger.error({ err, identificador }, 'Erro ao criar campanha no Meta');
    await atualizarStatusCampanha(pendente.id, 'erro');
    limparHistorico(identificador);  // limpa sessão no erro para não reutilizar imagem ou contexto
    const msg = (err as Error).message;
    if (msg === 'META_TOKEN_EXPIRADO') {
      await reply('❌ Token Meta expirado. O administrador precisa gerar um novo token em developers.facebook.com e atualizar o META_ACCESS_TOKEN no servidor.');
    } else {
      await reply(`❌ Erro ao criar campanha no Meta Ads: ${msg}`);
    }
  }
}

// ── Service público ───────────────────────────────────────────────────────────

export const adsService = {

  /** Chamado pelo webhook do WhatsApp — envia resposta de volta via WhatsApp */
  async processarMensagem(
    telefone:      string,
    texto:         string,
    imagemBase64?: string,
  ): Promise<void> {
    const [gestor] = await db
      .select({ id: gestoresTrafego.id })
      .from(gestoresTrafego)
      .where(eq(gestoresTrafego.telefoneWhatsapp, telefone))
      .limit(1);

    if (!gestor) {
      logger.debug({ telefone }, 'Mensagem ignorada: telefone não é de gestor cadastrado');
      return;
    }

    const reply: ReplyFn = (text) => whatsappService.enviarMensagem(telefone, text).then(() => undefined);
    await processarInterno(telefone, texto, imagemBase64, reply);
  },

  /** Chamado pela API web — retorna o texto da resposta diretamente */
  async processarMensagemWeb(
    gestorId:      number,
    texto:         string,
    imagemBase64?: string,
  ): Promise<string> {
    const identificador = `web:${gestorId}`;
    const respostas: string[] = [];
    const reply: ReplyFn = async (text) => { respostas.push(text); };

    await processarInterno(identificador, texto, imagemBase64, reply);

    return respostas.join('\n\n') || '...';
  },

  /** Lista as campanhas de todas as farmácias vinculadas ao gestor */
  async getCampanhasDoGestor(gestorId: number) {
    return getCampanhasPorGestor(gestorId);
  },

  /**
   * Contas de anúncio do token Meta — servidas do cache (ver comentário acima).
   *   • cache ausente ou `forcar` → busca e espera (só a 1ª vez, ou pós-restart);
   *   • cache velho  → devolve o que tem agora e atualiza em background;
   *   • cache fresco → devolve direto.
   */
  async getContasAnuncio(token: string, opts?: { forcar?: boolean }): Promise<ContaAnuncio[]> {
    if (!cacheContas || opts?.forcar) {
      return sincronizarContas(token);
    }

    const velho = Date.now() - cacheContas.atualizadoEm > TTL_CONTAS_MS;
    if (velho) {
      void sincronizarContas(token).catch((err) => {
        logger.warn({ err }, 'Refresh de contas de anúncio em background falhou');
      });
    }

    return cacheContas.contas;
  },
};
