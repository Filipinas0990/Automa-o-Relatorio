// Criação de Campanha → Conjunto de Anúncios → Anúncio na Meta Marketing API

import { metaReq } from './client';
import type { CriarCampanhaInput, CampanhaCriada } from './types';

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
};

// billing_event: IMPRESSIONS para todos — evita exigência de bid manual
const BILLING_EVENT: Record<string, string> = {
  LINK_CLICKS:          'IMPRESSIONS',
  REACH:                'IMPRESSIONS',
  OFFSITE_CONVERSIONS:  'IMPRESSIONS',
  LEAD_GENERATION:      'IMPRESSIONS',
};

const GENERO_META: Record<string, number[]> = {
  ALL:    [1, 2],
  MALE:   [1],
  FEMALE: [2],
};

export async function criarCampanhaCompleta(
  input: CriarCampanhaInput,
): Promise<CampanhaCriada> {
  const { token, nome, objetivo, orcamentoDiario, dataInicio, dataFim, publico, copy, imagemHash } = input;

  const metaObjetivo   = OBJETIVO_META[objetivo] ?? 'OUTCOME_TRAFFIC';
  const optGoal        = OPTIMIZATION_GOAL[metaObjetivo] ?? 'LINK_CLICKS';
  const billingEvent   = BILLING_EVENT[optGoal] ?? 'IMPRESSIONS';

  // 1. Campanha
  const campanha = await metaReq<{ id: string }>(
    'POST',
    `/${token.adAccountId}/campaigns`,
    token.accessToken,
    {
      name:                            nome,
      objective:                       metaObjetivo,
      status:                          'PAUSED',
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
    status:            'PAUSED',
  };

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

  // 3. Anúncio (Ad) — só cria se tiver creative
  let anuncioId = '';
  if (imagemHash) {
    const anuncio = await metaReq<{ id: string }>(
      'POST',
      `/${token.adAccountId}/ads`,
      token.accessToken,
      {
        name:     `${nome} — Anúncio`,
        adset_id: conjunto.id,
        creative: { creative_id: imagemHash },
        status:   'PAUSED',
      },
    );
    anuncioId = anuncio.id;
  }
  // Sem criativo: campanha e ad set são criados pausados;
  // o gestor adiciona o criativo manualmente no Ads Manager.

  return {
    campanhaId:      campanha.id,
    conjuntoId:      conjunto.id,
    anuncioId,
    linkGerenciador: `https://www.facebook.com/adsmanager/manage/ads?act=${token.adAccountId.replace('act_', '')}&selected_campaign_ids=${campanha.id}`,
  };
}
