import { metaReq } from '../meta/client';
import { uploadImagem, criarAdCreative } from '../meta/criativo';
import { criarCampanhaCompleta, criarAnuncios } from '../meta/campanha';
import { duplicarConjunto, atualizarConjunto } from '../meta/gerenciador';
import { gerarCopyPadrao } from './copy-ia';
import { logger } from '../logger';
import type { MetaToken } from '../meta/types';

// ── Tipos do payload que vem do wizard ────────────────────────────────────────

export interface PublicarCampanhaInput {
  nomeCampanha?: string;   // nome definido pelo gestor no wizard
  conta: {
    id: string;          // "act_..."
    nome?: string;
    cliente?: string;
  };
  objetivo: {
    codigo: string;      // OUTCOME_*
    nome?: string;
  };
  publico: {
    genero: 'todos' | 'homens' | 'mulheres';
    idadeMin: number;
    idadeMax: number;
  };
  orcamento: {
    diarioCentavos: number;
    dataInicio: string;
    dataFim: string | null;
  };
  criativos: {
    itens: Array<{ nome: string; preco?: string | null; pngBase64?: string | null }>;
    copy: { textoPrincipal?: string; titulo?: string; descricao?: string };
  };
}

const GENERO_MAP: Record<string, 'ALL' | 'MALE' | 'FEMALE'> = {
  todos: 'ALL', homens: 'MALE', mulheres: 'FEMALE',
};

/**
 * Descobre a página do Facebook associada à conta de anúncios (necessária para o criativo).
 * Estratégia: business da conta → owned_pages → client_pages → promote_pages.
 * (promote_pages costuma vir vazio; a página real fica no Business Manager da conta.)
 */
async function descobrirPageId(token: MetaToken): Promise<string | null> {
  const buscar = async (path: string): Promise<string | null> => {
    try {
      const res = await metaReq<{ data?: Array<{ id: string }> }>('GET', path, token.accessToken);
      return res.data?.[0]?.id ?? null;
    } catch (e) {
      logger.warn({ err: (e as Error).message, path }, 'Falha ao buscar página');
      return null;
    }
  };

  // 1) Descobre o Business Manager da conta
  let businessId: string | null = null;
  try {
    const res = await metaReq<{ business?: { id: string } }>(
      'GET', `/${token.adAccountId}?fields=business`, token.accessToken,
    );
    businessId = res.business?.id ?? null;
  } catch (e) {
    logger.warn({ err: (e as Error).message }, 'Não consegui obter o business da conta');
  }

  // 2) Páginas do business (owned → client), 3) fallback promote_pages
  if (businessId) {
    const owned = await buscar(`/${businessId}/owned_pages?fields=id,name&limit=1`);
    if (owned) return owned;
    const client = await buscar(`/${businessId}/client_pages?fields=id,name&limit=1`);
    if (client) return client;
  }
  return buscar(`/${token.adAccountId}/promote_pages?fields=id,name&limit=1`);
}

type ItemCriativo = {
  nome: string;
  preco?: string | null;
  pngBase64?: string | null;
  // Copy por criativo (copy padrão com {produto}/{preco}/{cidade} já expandidos no front).
  // Se vier vazio, cai na copy da campanha (fallback).
  textoPrincipal?: string | null;
  titulo?: string | null;
  descricao?: string | null;
};
type Copy = { textoPrincipal: string; titulo: string; descricao: string };

/**
 * Sobe cada PNG e cria um AdCreative por imagem. Cada criativo vira depois um
 * anúncio separado no mesmo conjunto, então o Meta rotaciona entre eles e
 * entrega mais o que performa melhor.
 *
 * Falha isolada (imagem rejeitada, upload que caiu) não derruba o resto:
 * registra o aviso e segue com os demais criativos.
 */
async function subirCriativos(
  token:        MetaToken,
  pageId:       string | null,
  itens:        ItemCriativo[],
  copy:         Copy,
  usarWhatsapp: boolean,
  avisos:       string[],
): Promise<Array<{ creativeId: string; rotulo: string }>> {
  const criativos: Array<{ creativeId: string; rotulo: string }> = [];
  const comImagem = itens.filter((i) => i.pngBase64);

  if (!pageId) {
    avisos.push('Nenhuma página do Facebook encontrada para esta conta — nada foi criado sem anúncio (adicione o criativo manualmente no Ads Manager).');
    return criativos;
  }
  if (!comImagem.length) {
    avisos.push('Nenhum criativo com imagem foi enviado.');
    return criativos;
  }

  const linkDestino = `https://www.facebook.com/${pageId}`;   // usado quando não é WhatsApp
  for (const item of comImagem) {
    try {
      const img = await uploadImagem(token, item.pngBase64!, item.nome);
      // Copy por criativo (copy padrão expandida no front); cai na copy da campanha se vier vazia.
      const textoItem     = item.textoPrincipal?.trim() || copy.textoPrincipal;
      const tituloItem    = item.titulo?.trim()         || copy.titulo;
      const descricaoItem = item.descricao?.trim()      || copy.descricao;
      const creative = await criarAdCreative(token, img.hash, textoItem, linkDestino, {
        titulo: tituloItem, descricao: descricaoItem, whatsapp: usarWhatsapp,
      });
      criativos.push({ creativeId: creative.id, rotulo: item.nome });
    } catch (e) {
      const msg = (e as Error).message;
      logger.warn({ err: msg, criativo: item.nome }, 'Falha ao subir criativo');
      avisos.push(`Criativo "${item.nome}" não pôde ser enviado: ${msg}`);
    }
  }

  if (!criativos.length) {
    avisos.push('Nenhum criativo pôde ser enviado ao Meta.');
  }
  return criativos;
}

/** Monta a copy final: usa a do gestor e completa o que faltar com o template. */
function resolverCopy(
  manual:   { textoPrincipal?: string; titulo?: string; descricao?: string } | undefined,
  produtos: string[],
  farmacia: string | undefined,
): Copy {
  const copy: Copy = {
    textoPrincipal: (manual?.textoPrincipal ?? '').trim(),
    titulo:         (manual?.titulo ?? '').trim(),
    descricao:      (manual?.descricao ?? '').trim(),
  };
  if (copy.textoPrincipal) return copy;

  const padrao = gerarCopyPadrao({ produtos: produtos.filter(Boolean), farmacia });
  return {
    textoPrincipal: padrao.textoPrincipal,
    titulo:         copy.titulo    || padrao.titulo,
    descricao:      copy.descricao || padrao.descricao,
  };
}

/**
 * Publica uma campanha no Meta a partir do payload do wizard.
 * IA só é chamada 1x, e apenas se a copy não veio preenchida.
 * A campanha é criada ATIVA.
 */
export async function publicarCampanha(input: PublicarCampanhaInput): Promise<{
  campanhaId: string;
  conjuntoId: string;
  anuncioId: string;
  anuncioIds: string[];
  linkGerenciador: string;
  copyUsada: { textoPrincipal: string; titulo: string; descricao: string };
  avisos: string[];
}> {
  const avisos: string[] = [];
  const accessToken = process.env.META_ACCESS_TOKEN ?? '';
  if (!accessToken) throw new Error('META_ACCESS_TOKEN não configurado no servidor.');

  const adAccountId = input.conta.id.startsWith('act_') ? input.conta.id : `act_${input.conta.id}`;

  // Página do Facebook (necessária para criar o criativo)
  const pageId = await descobrirPageId({ farmaciaId: 0, adAccountId, pageId: '', accessToken });

  const token: MetaToken = { farmaciaId: 0, adAccountId, pageId: pageId ?? '', accessToken };

  // ── 1) Copy: usa a do gestor; se faltar, usa uma copy padrão (SEM IA) ───────
  const copy = resolverCopy(
    input.criativos.copy,
    input.criativos.itens.map((i) => i.nome),
    input.conta.cliente ?? input.conta.nome,
  );

  // Usa o nome definido no wizard; se vier vazio, gera um padrão
  const nomeCampanha = (input.nomeCampanha?.trim()
    || `${input.conta.cliente ?? input.conta.nome ?? 'Campanha'} — ${input.objetivo.nome ?? input.objetivo.codigo}`
  ).slice(0, 100);

  // Destino WhatsApp (conversa) para Tráfego, Engajamento e Vendas — precisa de página.
  // Reconhecimento (alcance) e Cadastros não usam WhatsApp.
  const OBJ_WHATSAPP = ['OUTCOME_TRAFFIC', 'OUTCOME_ENGAGEMENT', 'OUTCOME_SALES'];
  const usarWhatsapp = !!pageId && OBJ_WHATSAPP.includes(input.objetivo.codigo);

  // ── 2) Criativos: sobe TODOS os PNGs, um AdCreative por imagem ──────────────
  const criativosMeta = await subirCriativos(
    token, pageId, input.criativos.itens, copy, usarWhatsapp, avisos,
  );

  // ── 3) Campanha ATIVA ───────────────────────────────────────────────────────
  const resultado = await criarCampanhaCompleta({
    token,
    nome:            nomeCampanha,
    objetivo:        input.objetivo.codigo,          // OUTCOME_*
    orcamentoDiario: input.orcamento.diarioCentavos, // centavos
    dataInicio:      input.orcamento.dataInicio,
    dataFim:         input.orcamento.dataFim,
    status:          'ACTIVE',
    whatsapp:        usarWhatsapp,
    publico: {
      genero:      GENERO_MAP[input.publico.genero] ?? 'ALL',
      idadeMin:    input.publico.idadeMin,
      idadeMax:    input.publico.idadeMax,
      localizacao: 'Brasil',
    },
    copy:      copy.textoPrincipal,
    criativos: criativosMeta,   // N criativos → N anúncios no mesmo conjunto
  });

  return { ...resultado, copyUsada: copy, avisos };
}

// ── Fluxo "partir de um conjunto existente" ───────────────────────────────────

export interface NovosAnunciosInput {
  conta:      { id: string; nome?: string; cliente?: string };
  conjuntoId: string;                 // conjunto de origem, que fica INTACTO
  nomeConjunto?: string;              // nome da cópia
  destinoWhatsapp?: boolean;          // herdado do conjunto de origem
  publico:    { genero: 'todos' | 'homens' | 'mulheres'; idadeMin: number; idadeMax: number };
  orcamento:  { diarioCentavos: number; dataInicio: string; dataFim: string | null };
  criativos:  { itens: ItemCriativo[]; copy: { textoPrincipal?: string; titulo?: string; descricao?: string } };
  ativar?:    boolean;                // false = cópia nasce pausada
}

/**
 * Cria uma CÓPIA do conjunto escolhido (sem os anúncios antigos), aplica as
 * configurações que o gestor revisou e sobe os criativos novos dentro dela.
 * O conjunto original não é tocado — continua rodando com o aprendizado dele.
 */
export async function publicarNovosAnuncios(input: NovosAnunciosInput): Promise<{
  conjuntoId:      string;
  anuncioIds:      string[];
  linkGerenciador: string;
  copyUsada:       Copy;
  avisos:          string[];
}> {
  const avisos: string[] = [];
  const accessToken = process.env.META_ACCESS_TOKEN ?? '';
  if (!accessToken) throw new Error('META_ACCESS_TOKEN não configurado no servidor.');

  const adAccountId = input.conta.id.startsWith('act_') ? input.conta.id : `act_${input.conta.id}`;
  const pageId = await descobrirPageId({ farmaciaId: 0, adAccountId, pageId: '', accessToken });
  const token: MetaToken = { farmaciaId: 0, adAccountId, pageId: pageId ?? '', accessToken };

  const status: 'ACTIVE' | 'PAUSED' = input.ativar ? 'ACTIVE' : 'PAUSED';

  // 1) Cópia SEM os anúncios antigos — só queremos a configuração herdada.
  const copia = await duplicarConjunto(accessToken, input.conjuntoId, {
    comAnuncios: false,
    status,
    sufixo:      ' — Novos criativos',
  });

  // 2) Aplica o que o gestor revisou na etapa de público/orçamento.
  try {
    // O nome não vai aqui: o sufixo " — Novos criativos" já foi aplicado pelo
    // rename_options do /copies.
    await atualizarConjunto(accessToken, copia.conjuntoId, {
      orcamentoDiarioCentavos: input.orcamento.diarioCentavos,
      dataInicio:              input.orcamento.dataInicio,
      dataFim:                 input.orcamento.dataFim,
      publico:                 input.publico,
    });
  } catch (e) {
    // A cópia já existe; sem isso ela roda com a config herdada do original.
    const msg = (e as Error).message;
    logger.warn({ err: msg, conjunto: copia.conjuntoId }, 'Falha ao aplicar configs na cópia');
    avisos.push(`As configurações revisadas não puderam ser aplicadas (${msg}). A cópia ficou com a configuração do conjunto original.`);
  }

  // 3) Criativos novos → anúncios dentro da cópia.
  const copy = resolverCopy(
    input.criativos.copy,
    input.criativos.itens.map((i) => i.nome),
    input.conta.cliente ?? input.conta.nome,
  );
  const criativosMeta = await subirCriativos(
    token, pageId, input.criativos.itens, copy, !!input.destinoWhatsapp, avisos,
  );

  const nomeBase = (input.nomeConjunto?.trim() || 'Novos criativos').slice(0, 80);
  const anuncioIds = criativosMeta.length
    ? await criarAnuncios(token, copia.conjuntoId, nomeBase, criativosMeta, status)
    : [];

  if (!anuncioIds.length) {
    avisos.push('A cópia do conjunto foi criada, mas ficou sem anúncios.');
  }

  return {
    conjuntoId: copia.conjuntoId,
    anuncioIds,
    linkGerenciador: `https://www.facebook.com/adsmanager/manage/adsets?act=${adAccountId.replace('act_', '')}&selected_adset_ids=${copia.conjuntoId}`,
    copyUsada: copy,
    avisos,
  };
}
