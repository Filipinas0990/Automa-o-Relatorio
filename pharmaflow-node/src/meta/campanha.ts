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

/**
 * Cria os anúncios de um conjunto — um por criativo. Com mais de um, o rótulo
 * vai numerado, porque no Ads Manager o gestor precisa distinguir os anúncios
 * entre si para comparar performance.
 */
export async function criarAnuncios(
  token:      MetaToken,
  conjuntoId: string,
  nomeBase:   string,
  criativos:  Array<{ creativeId: string; rotulo: string }>,
  status:     'ACTIVE' | 'PAUSED',
): Promise<string[]> {
  const ids: string[] = [];
  for (const [i, c] of criativos.entries()) {
    const nome = (criativos.length > 1
      ? `${nomeBase} — ${i + 1}. ${c.rotulo}`
      : `${nomeBase} — ${c.rotulo}`
    ).slice(0, 100);

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

  // Monta targeting — usa Brasil como padrão quando não há geocoding disponível
  const targeting: Record<string, unknown> = {
    age_min: publico.idadeMin ?? 18,
    age_max: publico.idadeMax ?? 65,
    genders: GENERO_META[publico.genero ?? 'ALL'],
    geo_locations: {
      countries:      ['BR'],
      location_types: ['home', 'recent'],
    },
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

  const anuncioIds = await criarAnuncios(token, conjunto.id, nome, criativos, status);

  return {
    campanhaId:      campanha.id,
    conjuntoId:      conjunto.id,
    anuncioId:       anuncioIds[0] ?? '',
    anuncioIds,
    linkGerenciador: `https://www.facebook.com/adsmanager/manage/ads?act=${token.adAccountId.replace('act_', '')}&selected_campaign_ids=${campanha.id}`,
  };
}
