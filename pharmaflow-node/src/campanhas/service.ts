import { metaReq } from '../meta/client';
import { uploadImagem, criarAdCreative } from '../meta/criativo';
import { criarCampanhaCompleta } from '../meta/campanha';
import { gerarCopyIA } from './copy-ia';
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

/**
 * Publica uma campanha no Meta a partir do payload do wizard.
 * IA só é chamada 1x, e apenas se a copy não veio preenchida.
 * A campanha é criada ATIVA.
 */
export async function publicarCampanha(input: PublicarCampanhaInput): Promise<{
  campanhaId: string;
  conjuntoId: string;
  anuncioId: string;
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

  // ── 1) Copy: usa a do gestor; se faltar, IA gera (1x) ───────────────────────
  const copyManual = input.criativos.copy ?? {};
  let copy = {
    textoPrincipal: (copyManual.textoPrincipal ?? '').trim(),
    titulo:         (copyManual.titulo ?? '').trim(),
    descricao:      (copyManual.descricao ?? '').trim(),
  };

  if (!copy.textoPrincipal) {
    logger.info('Copy vazia — gerando via IA');
    const gerada = await gerarCopyIA({
      produtos: input.criativos.itens.map((i) => i.nome).filter(Boolean),
      objetivo: input.objetivo.nome ?? input.objetivo.codigo,
      farmacia: input.conta.cliente ?? input.conta.nome,
    });
    copy = {
      textoPrincipal: gerada.textoPrincipal || 'Ofertas especiais na sua farmácia!',
      titulo:         copy.titulo    || gerada.titulo,
      descricao:      copy.descricao || gerada.descricao,
    };
  }

  // Usa o nome definido no wizard; se vier vazio, gera um padrão
  const nomeCampanha = (input.nomeCampanha?.trim()
    || `${input.conta.cliente ?? input.conta.nome ?? 'Campanha'} — ${input.objetivo.nome ?? input.objetivo.codigo}`
  ).slice(0, 100);

  // ── 2) Criativo: sobe o 1º PNG e cria o AdCreative ──────────────────────────
  let creativeId: string | undefined;
  const primeiro = input.criativos.itens.find((i) => i.pngBase64);

  if (!pageId) {
    avisos.push('Nenhuma página do Facebook encontrada para esta conta — campanha criada sem anúncio (adicione o criativo manualmente no Ads Manager).');
  } else if (!primeiro?.pngBase64) {
    avisos.push('Nenhum criativo com imagem foi enviado — campanha criada sem anúncio.');
  } else {
    const img = await uploadImagem(token, primeiro.pngBase64, primeiro.nome);
    const linkDestino = `https://www.facebook.com/${pageId}`;   // v1: leva à página
    const creative = await criarAdCreative(token, img.hash, copy.textoPrincipal, linkDestino, {
      titulo: copy.titulo, descricao: copy.descricao,
    });
    creativeId = creative.id;
    if (input.criativos.itens.filter((i) => i.pngBase64).length > 1) {
      avisos.push('Apenas o primeiro criativo foi usado nesta versão. Os demais podem ser adicionados no Ads Manager.');
    }
  }

  // ── 3) Campanha ATIVA ───────────────────────────────────────────────────────
  const resultado = await criarCampanhaCompleta({
    token,
    nome:            nomeCampanha,
    objetivo:        input.objetivo.codigo,          // OUTCOME_*
    orcamentoDiario: input.orcamento.diarioCentavos, // centavos
    dataInicio:      input.orcamento.dataInicio,
    dataFim:         input.orcamento.dataFim,
    status:          'ACTIVE',
    publico: {
      genero:      GENERO_MAP[input.publico.genero] ?? 'ALL',
      idadeMin:    input.publico.idadeMin,
      idadeMax:    input.publico.idadeMax,
      localizacao: 'Brasil',
    },
    copy:       copy.textoPrincipal,
    imagemHash: creativeId,   // id do AdCreative (ou undefined = sem anúncio)
  });

  return { ...resultado, copyUsada: copy, avisos };
}
