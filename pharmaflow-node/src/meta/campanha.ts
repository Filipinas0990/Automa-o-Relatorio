// Criação de Campanha → Conjunto de Anúncios → Anúncio na Meta Marketing API

import { metaReq } from './client';
import type { CriarCampanhaInput, CampanhaCriada, MetaToken } from './types';

const OBJETIVO_META: Record<string, string> = {
  CONVERSIONS:     'OUTCOME_SALES',
  LINK_CLICKS:     'OUTCOME_TRAFFIC',
  REACH:           'OUTCOME_AWARENESS',
  LEAD_GENERATION: 'OUTCOME_LEADS',
};

// Mapeamento de objetivo → optimization_goal válido para o Ad Set
const OPTIMIZATION_GOAL: Record<string, string> = {
  OUTCOME_TRAFFIC:    'LINK_CLICKS',
  OUTCOME_AWARENESS:  'REACH',
  OUTCOME_SALES:      'OFFSITE_CONVERSIONS',
  OUTCOME_LEADS:      'LEAD_GENERATION',
  OUTCOME_ENGAGEMENT: 'POST_ENGAGEMENT',
};

// billing_event: IMPRESSIONS para todos — evita exigência de bid manual
const BILLING_EVENT: Record<string, string> = {
  LINK_CLICKS:          'IMPRESSIONS',
  REACH:                'IMPRESSIONS',
  OFFSITE_CONVERSIONS:  'IMPRESSIONS',
  LEAD_GENERATION:      'IMPRESSIONS',
  POST_ENGAGEMENT:      'IMPRESSIONS',
};

const GENERO_META: Record<string, number[]> = {
  ALL:    [1, 2],
  MALE:   [1],
  FEMALE: [2],
};

// "feed" no Instagram é a posição "stream" na Graph API — nomes diferentes do Facebook.
const POSICOES_FACEBOOK: Record<string, string[]> = {
  feed:        ['feed'],
  story:       ['story'],
  feed_story:  ['feed', 'story'],
  story_reels: ['story', 'facebook_reels'],
};
const POSICOES_INSTAGRAM: Record<string, string[]> = {
  feed:        ['stream'],
  story:       ['story'],
  feed_story:  ['stream', 'story'],
  story_reels: ['story', 'reels'],
};

/**
 * Monta publisher_platforms/facebook_positions/instagram_positions a partir
 * das escolhas do wizard. "todas" + "todos" (ou nada escolhido) omite os três
 * campos de propósito — é o que ativa o Advantage+ placements (Meta escolhe
 * sozinho), que é o padrão recomendado.
 */
function montarPlacements(
  plataforma?:     'todas' | 'instagram' | 'facebook',
  posicionamento?: 'todos' | 'feed' | 'story' | 'feed_story' | 'story_reels',
): Record<string, unknown> {
  if (!plataforma || plataforma === 'todas') {
    if (!posicionamento || posicionamento === 'todos') return {};
    return {
      publisher_platforms: ['facebook', 'instagram'],
      facebook_positions:  POSICOES_FACEBOOK[posicionamento],
      instagram_positions: POSICOES_INSTAGRAM[posicionamento],
    };
  }

  if (plataforma === 'facebook') {
    return {
      publisher_platforms: ['facebook'],
      ...(posicionamento && posicionamento !== 'todos'
        ? { facebook_positions: POSICOES_FACEBOOK[posicionamento] }
        : {}),
    };
  }

  // instagram
  return {
    publisher_platforms: ['instagram'],
    ...(posicionamento && posicionamento !== 'todos'
      ? { instagram_positions: POSICOES_INSTAGRAM[posicionamento] }
      : {}),
  };
}

/** Hoje em Brasília, YYYY-MM-DD. */
function hojeSaoPaulo(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

/**
 * Data em que o anúncio começa a rodar, em D/M sem zero à esquerda ("2/10",
 * "15/9") — padrão de nome da agência: o início do conjunto,
 * ou hoje se esse início já passou (anúncio novo em conjunto que já roda
 * começa no dia em que é publicado).
 */
export function dataDeInicioDoAnuncio(dataInicio?: string | null): string {
  const hoje = hojeSaoPaulo();
  const data = dataInicio && dataInicio > hoje ? dataInicio : hoje;
  const [, m, d] = data.slice(0, 10).split('-');
  return `${Number(d)}/${Number(m)}`;
}

/**
 * Próximo número livre de AD num conjunto que já tem anúncios: com AD01..AD04
 * lá dentro, o próximo é 5. Lê só os nomes; conjunto vazio (ou nome fora do
 * padrão) começa no 1.
 */
export async function proximoNumeroDeAnuncio(token: MetaToken, conjuntoId: string): Promise<number> {
  const r = await metaReq<{ data?: Array<{ name?: string }> }>(
    'GET', `/${conjuntoId}/ads?fields=name&limit=500`, token.accessToken,
  );
  let maior = 0;
  for (const a of r.data ?? []) {
    const m = /^AD(\d+)\b/i.exec(a.name?.trim() ?? '');
    if (m) maior = Math.max(maior, Number(m[1]));
  }
  return maior + 1;
}

/**
 * Cria os anúncios de um conjunto — um por criativo — com o nome no padrão da
 * agência: "AD01 - Nome do produto - 2/10" (data em que começa a rodar).
 * `numeroInicial` > 1 quando o conjunto já tem anúncios (ver proximoNumeroDeAnuncio).
 */
export async function criarAnuncios(
  token:         MetaToken,
  conjuntoId:    string,
  criativos:     Array<{ creativeId: string; rotulo: string; nomeAnuncio?: string | null }>,
  status:        'ACTIVE' | 'PAUSED',
  dataInicio:    string,
  numeroInicial = 1,
): Promise<string[]> {
  const ids: string[] = [];
  for (const [i, c] of criativos.entries()) {
    const numero = String(numeroInicial + i).padStart(2, '0');
    // Corta o produto, e não a data, quando passa do limite de 100 do Meta.
    const sufixo = ` - ${dataInicio}`;
    // Nome que o gestor digitou na revisão manda; sem ele, o padrão.
    const nome = c.nomeAnuncio?.trim()
      ? c.nomeAnuncio.trim().slice(0, 100)
      : `AD${numero} - ${c.rotulo.trim()}`.slice(0, 100 - sufixo.length) + sufixo;

    const anuncio = await metaReq<{ id: string }>(
      'POST',
      `/${token.adAccountId}/ads`,
      token.accessToken,
      { name: nome, adset_id: conjuntoId, creative: { creative_id: c.creativeId }, status },
    );
    ids.push(anuncio.id);
  }
  return ids;
}

export async function criarCampanhaCompleta(
  input: CriarCampanhaInput,
): Promise<CampanhaCriada> {
  const { token, nome, objetivo, orcamentoDiario, dataInicio, dataFim, publico, imagemHash } = input;
  const status = input.status ?? 'PAUSED';
  const whatsapp = input.whatsapp === true;

  // Aceita OUTCOME_* direto (novo wizard) ou os códigos legados (fluxo WhatsApp)
  const metaObjetivo   = objetivo.startsWith('OUTCOME_')
    ? objetivo
    : (OBJETIVO_META[objetivo] ?? 'OUTCOME_TRAFFIC');

  // Click-to-WhatsApp: destino = conversa. Tráfego otimiza por cliques; demais por conversas.
  const optGoal = whatsapp
    ? (metaObjetivo === 'OUTCOME_TRAFFIC' ? 'LINK_CLICKS' : 'CONVERSATIONS')
    : (OPTIMIZATION_GOAL[metaObjetivo] ?? 'LINK_CLICKS');
  const billingEvent   = BILLING_EVENT[optGoal] ?? 'IMPRESSIONS';

  // 1. Campanha
  const campanha = await metaReq<{ id: string }>(
    'POST',
    `/${token.adAccountId}/campaigns`,
    token.accessToken,
    {
      name:                            nome,
      objective:                       metaObjetivo,
      status,
      special_ad_categories:           [],
      is_adset_budget_sharing_enabled: false,  // orçamento gerenciado por ad set
    },
  );

  // Localização: com cidade escolhida, segmenta por ela + raio; sem cidade, Brasil inteiro.
  const geoLocations: Record<string, unknown> = publico.localizacao
    ? {
        cities: [{
          key:           publico.localizacao.key,
          radius:        publico.raioKm ?? 10,
          distance_unit: 'kilometer',
        }],
        location_types: ['home', 'recent'],
      }
    : {
        countries:      ['BR'],
        location_types: ['home', 'recent'],
      };

  const targeting: Record<string, unknown> = {
    age_min: publico.idadeMin ?? 18,
    age_max: publico.idadeMax ?? 65,
    genders: GENERO_META[publico.genero ?? 'ALL'],
    geo_locations: geoLocations,
    ...montarPlacements(publico.plataforma, publico.posicionamento),
    targeting_automation: {
      advantage_audience: 0,  // 0 = desabilitado (público manual)
    },
  };

  // 2. Conjunto de Anúncios (Ad Set)
  const adSetBody: Record<string, unknown> = {
    name:              `${nome} — Conjunto`,
    campaign_id:       campanha.id,
    daily_budget:      orcamentoDiario,
    start_time:        `${dataInicio}T00:00:00-0300`,
    billing_event:     billingEvent,
    optimization_goal: optGoal,
    bid_strategy:      'LOWEST_COST_WITHOUT_CAP',
    targeting,
    status,
  };

  // Click-to-WhatsApp: destino da conversa = a página (com WhatsApp conectado)
  if (whatsapp) {
    adSetBody.destination_type = 'WHATSAPP';
    adSetBody.promoted_object   = { page_id: token.pageId };
  }

  // end_time só vai se tiver data de fim definida
  if (dataFim) {
    adSetBody.end_time = `${dataFim}T23:59:59-0300`;
  }

  const conjunto = await metaReq<{ id: string }>(
    'POST',
    `/${token.adAccountId}/adsets`,
    token.accessToken,
    adSetBody,
  );

  // 3. Anúncios (Ads) — um por criativo, todos no mesmo conjunto.
  // Sem criativo nenhum: campanha e ad set ficam sem anúncio e o gestor
  // adiciona manualmente no Ads Manager.
  const criativos = input.criativos?.length
    ? input.criativos
    : imagemHash
      ? [{ creativeId: imagemHash, rotulo: 'Anúncio' }]
      : [];

  const anuncioIds = await criarAnuncios(token, conjunto.id, criativos, status, dataDeInicioDoAnuncio(dataInicio));

  return {
    campanhaId:      campanha.id,
    conjuntoId:      conjunto.id,
    anuncioId:       anuncioIds[0] ?? '',
    anuncioIds,
    linkGerenciador: `https://www.facebook.com/adsmanager/manage/ads?act=${token.adAccountId.replace('act_', '')}&selected_campaign_ids=${campanha.id}`,
  };
}
