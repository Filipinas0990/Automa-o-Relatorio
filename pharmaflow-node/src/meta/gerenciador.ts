// Leitura ao vivo de campanhas/conjuntos no Meta + duplicação de conjunto.
// Usado pela tela "Campanhas" (gerenciador), separado do fluxo de criação.

import { metaReq } from './client';

// effective_status é o status REAL (considera pai pausado, rejeição, etc).
// status é só o que foi setado no objeto — por isso exibimos o effective.
const STATUS_LEGIVEL: Record<string, string> = {
  ACTIVE:                'Ativa',
  PAUSED:                'Pausada',
  DELETED:               'Excluída',
  ARCHIVED:              'Arquivada',
  CAMPAIGN_PAUSED:       'Campanha pausada',
  ADSET_PAUSED:          'Conjunto pausado',
  IN_PROCESS:            'Em processamento',
  WITH_ISSUES:           'Com problemas',
  PENDING_REVIEW:        'Em análise',
  DISAPPROVED:           'Reprovada',
};

const rotulo = (s?: string): string => STATUS_LEGIVEL[s ?? ''] ?? s ?? 'Desconhecido';

export interface ConjuntoMeta {
  id:              string;
  nome:            string;
  campanhaId:      string;
  campanhaNome:    string;
  status:          string;   // rótulo legível
  ativa:           boolean;
  orcamentoDiario: number;   // em reais (o Meta devolve centavos como string); 0 em campanha CBO
  /**
   * Campanha com orçamento de CAMPANHA (CBO / Advantage+ campaign budget): o
   * conjunto não tem orçamento próprio, e mandar `daily_budget` para ele é
   * recusado pelo Meta. O orçamento que vale é o da campanha, dividido entre
   * os conjuntos dela.
   */
  cbo:               boolean;
  /** Orçamento diário da campanha, em reais (só em CBO; 0 se o dela for vitalício). */
  orcamentoCampanha: number;
  /** Orçamento TOTAL da campanha, em reais (CBO com orçamento vitalício). */
  orcamentoCampanhaTotal: number;
  otimizacao:      string;
  idadeMin:        number | null;
  idadeMax:        number | null;
  genero:          'todos' | 'homens' | 'mulheres';
  generos:         string;   // rótulo legível do campo acima
  /** destination_type = WHATSAPP → os anúncios novos precisam do mesmo CTA. */
  destinoWhatsapp: boolean;
  dataInicio:      string;   // YYYY-MM-DD ("" se não houver)
  dataFim:         string;   // YYYY-MM-DD ("" = sem término)
  /**
   * Onde o conjunto entrega. No "Novo conjunto" a cópia HERDA isto (o app não
   * muda a localização), então a tela mostra só para conferência.
   */
  localizacao:     LocalizacaoConjunto;
  /** Público Advantage+: idade/gênero são só sugestão (ver aplicarPublico). */
  advantageAudience: boolean;
}

// Meta: genders [1]=homens, [2]=mulheres, ausente/ambos = todos
const GENERO = (g?: number[]): 'todos' | 'homens' | 'mulheres' => {
  if (!g?.length || g.length > 1) return 'todos';
  return g[0] === 1 ? 'homens' : 'mulheres';
};

const GENERO_LEGIVEL: Record<string, string> = {
  todos: 'Todos', homens: 'Homens', mulheres: 'Mulheres',
};

// ── Localização do conjunto (só leitura) ─────────────────────────────────────

interface GeoMeta {
  countries?:        string[];
  regions?:          Array<{ name?: string }>;
  cities?:           Array<{ name?: string; region?: string; radius?: number; distance_unit?: string }>;
  custom_locations?: Array<{
    name?: string; address_string?: string; latitude?: number; longitude?: number;
    radius?: number; distance_unit?: string;
  }>;
}

export interface LocalizacaoConjunto {
  /** Texto pronto: "Fortaleza (CE) + 10 km", "Av. X, 1400 + 3 km", "Brasil inteiro". */
  resumo:  string;
  /** Centro e raio para o mapa — só quando o Meta informa coordenada (endereço/pino). */
  lat?:    number;
  lng?:    number;
  raioKm?: number;
}

const emKm = (raio?: number, unidade?: string): number | undefined =>
  raio == null ? undefined : unidade === 'mile' ? Math.round(raio * 1.609 * 10) / 10 : raio;

function resumirLocalizacao(geo?: GeoMeta): LocalizacaoConjunto {
  if (!geo) return { resumo: 'Não informada' };
  const partes: string[] = [];
  let mapa: Pick<LocalizacaoConjunto, 'lat' | 'lng' | 'raioKm'> = {};

  for (const c of geo.custom_locations ?? []) {
    const km = emKm(c.radius, c.distance_unit);
    const nome = (c.name || c.address_string || 'Ponto no mapa').replace(/, Brasil$/, '');
    partes.push(km ? `${nome} + ${km} km` : nome);
    if (mapa.lat == null && c.latitude != null && c.longitude != null) {
      mapa = { lat: c.latitude, lng: c.longitude, raioKm: km };
    }
  }
  for (const c of geo.cities ?? []) {
    const km = emKm(c.radius, c.distance_unit);
    const nome = c.region ? `${c.name} (${c.region})` : (c.name ?? 'Cidade');
    partes.push(km ? `${nome} + ${km} km` : nome);
  }
  for (const r of geo.regions ?? []) partes.push(r.name ?? 'Estado');
  if (!partes.length && geo.countries?.length) {
    partes.push(geo.countries.length === 1 && geo.countries[0] === 'BR' ? 'Brasil inteiro' : geo.countries.join(', '));
  }

  const resumo = partes.length > 3 ? `${partes.slice(0, 3).join(' · ')} e mais ${partes.length - 3}` : partes.join(' · ');
  return { resumo: resumo || 'Não informada', ...mapa };
}

/** "2026-07-21T00:00:00-0300" → "2026-07-21" */
const soData = (t?: string): string => (t ? t.slice(0, 10) : '');

/**
 * TODOS os conjuntos da conta de anúncios, já com o nome da campanha de cada um.
 * Lista plana de propósito: o gestor quer achar o conjunto e duplicar, sem ter
 * que navegar campanha por campanha.
 */
export async function listarConjuntosDaConta(
  accessToken: string,
  adAccountId: string,
): Promise<ConjuntoMeta[]> {
  const FIELDS = 'name,effective_status,daily_budget,optimization_goal,targeting,'
    + 'destination_type,start_time,end_time,campaign{name,daily_budget,lifetime_budget}';
  const res = await metaReq<{
    data?: Array<{
      id: string; name?: string; effective_status?: string;
      daily_budget?: string; optimization_goal?: string; destination_type?: string;
      start_time?: string; end_time?: string;
      targeting?: {
        age_min?: number; age_max?: number; genders?: number[]; geo_locations?: GeoMeta;
        targeting_automation?: { advantage_audience?: number };
      };
      campaign?: { id?: string; name?: string; daily_budget?: string; lifetime_budget?: string };
    }>;
  }>('GET', `/${adAccountId}/adsets?fields=${FIELDS}&limit=100`, accessToken);

  return (res.data ?? [])
    .filter((a) => a.effective_status !== 'DELETED' && a.effective_status !== 'ARCHIVED')
    .map((a) => {
      const genero = GENERO(a.targeting?.genders);
      return {
        id:              a.id,
        nome:            a.name ?? `Conjunto ${a.id}`,
        campanhaId:      a.campaign?.id ?? '',
        campanhaNome:    a.campaign?.name ?? '',
        status:          rotulo(a.effective_status),
        ativa:           a.effective_status === 'ACTIVE',
        // A Graph API devolve daily_budget em centavos, como string.
        orcamentoDiario: Number(a.daily_budget ?? 0) / 100,
        // Orçamento na campanha = CBO. Os dois lados nunca têm orçamento ao mesmo tempo.
        cbo:               Number(a.campaign?.daily_budget ?? 0) > 0 || Number(a.campaign?.lifetime_budget ?? 0) > 0,
        orcamentoCampanha:      Number(a.campaign?.daily_budget ?? 0) / 100,
        orcamentoCampanhaTotal: Number(a.campaign?.lifetime_budget ?? 0) / 100,
        otimizacao:      a.optimization_goal ?? '',
        idadeMin:        a.targeting?.age_min ?? null,
        idadeMax:        a.targeting?.age_max ?? null,
        genero,
        generos:         GENERO_LEGIVEL[genero],
        destinoWhatsapp: a.destination_type === 'WHATSAPP',
        dataInicio:      soData(a.start_time),
        dataFim:         soData(a.end_time),
        localizacao:     resumirLocalizacao(a.targeting?.geo_locations),
        advantageAudience: a.targeting?.targeting_automation?.advantage_audience === 1,
      };
    });
}

/** Campos de posicionamento. Removê-los todos = Advantage+ (Meta escolhe sozinho). */
const CAMPOS_PLACEMENT = [
  'publisher_platforms', 'facebook_positions', 'instagram_positions',
  'audience_network_positions', 'messenger_positions', 'threads_positions',
] as const;

/**
 * Ajusta o targeting lido de um conjunto antigo para que ele seja ACEITO numa
 * escrita. O Meta só valida targeting quando grava: um conjunto que roda há
 * meses pode carregar combinação que hoje é recusada, e aí tanto editar quanto
 * recriar quebram — sem que o original tenha problema nenhum.
 *
 * Hoje trata a dependência do Explorar do Instagram: `explore_home` sozinho é
 * recusado, o Meta exige `explore` na mesma lista.
 */
function normalizarTargeting(targeting: Record<string, unknown>): Record<string, unknown> {
  const limpo: Record<string, unknown> = { ...targeting };
  // Campos que o Meta ainda DEVOLVE na leitura de conjunto antigo, mas recusa na
  // escrita: `targeting_optimization` foi removido ("Não é necessário definir um
  // valor para o campo targeting_optimization porque ele foi removido", #1870197,
  // 22/10/2026) — a recriação do conjunto quebrava com ele.
  delete limpo.targeting_optimization;

  const ig = limpo.instagram_positions;
  if (Array.isArray(ig) && ig.includes('explore_home') && !ig.includes('explore')) {
    limpo.instagram_positions = [...ig, 'explore'];
  }
  return limpo;
}

/** Tira os posicionamentos do targeting — o conjunto passa a usar Advantage+. */
function semPlacements(targeting: Record<string, unknown>): Record<string, unknown> {
  const limpo = { ...targeting };
  for (const campo of CAMPOS_PLACEMENT) delete limpo[campo];
  return limpo;
}

/** Data de hoje no fuso de Brasília, em YYYY-MM-DD (o formato das datas do wizard). */
function hojeSaoPaulo(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

/**
 * Atualiza um conjunto existente. O targeting é MESCLADO com o atual — o Meta
 * substitui o objeto inteiro, então enviar só idade/gênero apagaria a
 * geolocalização e a chamada seria rejeitada.
 */
type PublicoRevisado = { genero: 'todos' | 'homens' | 'mulheres'; idadeMin: number; idadeMax: number };

const GENEROS_META: Record<string, number[]> = { todos: [1, 2], homens: [1], mulheres: [2] };

/**
 * Aplica a idade/gênero revisados pelo gestor ao targeting de um conjunto.
 *
 * Só mexe se algo MUDOU — reenviar o público igual é risco à toa. E o caso que
 * quebrava: conjunto com Público Advantage+ (`advantage_audience: 1`) trata a
 * idade como "sugestão" (`age_range`) e recusa limite rígido ("faixa etária
 * inválida", visto em 20/10/2026). Decisão do dono: se o gestor mudou a idade
 * ou o gênero, a CÓPIA passa a público manual (Advantage+ desligado) e a idade
 * vale exata. O conjunto original não é tocado. Validado no Meta (validate_only).
 */
export function aplicarPublico(
  targeting: Record<string, unknown>,
  publico:   PublicoRevisado,
): { targeting: Record<string, unknown>; mudou: boolean; advantageDesligado: boolean } {
  const generos = targeting.genders as number[] | undefined;
  const generoAtual = !generos?.length || generos.length > 1 ? 'todos' : generos[0] === 1 ? 'homens' : 'mulheres';
  const mudou =
    publico.idadeMin !== (targeting.age_min ?? 18) ||
    publico.idadeMax !== (targeting.age_max ?? 65) ||
    publico.genero !== generoAtual;
  if (!mudou) return { targeting, mudou: false, advantageDesligado: false };

  const novo: Record<string, unknown> = {
    ...targeting,
    age_min: publico.idadeMin,
    age_max: publico.idadeMax,
    genders: GENEROS_META[publico.genero] ?? [1, 2],
  };
  // A faixa "sugerida" antiga conflita com a idade nova — sai sempre.
  delete novo.age_range;

  const automacao = targeting.targeting_automation as { advantage_audience?: number } | undefined;
  const advantageDesligado = automacao?.advantage_audience === 1;
  if (advantageDesligado) novo.targeting_automation = { advantage_audience: 0 };

  return { targeting: normalizarTargeting(novo), mudou: true, advantageDesligado };
}

export async function atualizarConjunto(
  accessToken: string,
  conjuntoId:  string,
  dados: {
    nome?:                    string;
    orcamentoDiarioCentavos?: number;
    dataInicio?:              string;
    dataFim?:                 string | null;
    publico?: PublicoRevisado;
  },
): Promise<{ advantageDesligado: boolean }> {
  const body: Record<string, unknown> = {};
  let advantageDesligado = false;

  if (dados.nome)                    body.name         = dados.nome.slice(0, 100);
  // Orçamento só vai se o conjunto TEM orçamento próprio — ver mais abaixo.
  // Só manda o início se ele é FUTURO: a cópia herda a data do original (já
  // passada), e o Meta recusa a atualização INTEIRA (público e orçamento juntos)
  // com "o horário de início não poderá ser editado se o conjunto já tiver sido
  // iniciado" — inclusive quando se manda a data de HOJE (visto em 07/10/2026).
  if (dados.dataInicio && dados.dataInicio > hojeSaoPaulo()) {
    body.start_time = `${dados.dataInicio}T00:00:00-0300`;
  }
  if (dados.dataFim)                 body.end_time     = `${dados.dataFim}T23:59:59-0300`;

  const precisaLer = !!dados.publico || !!dados.orcamentoDiarioCentavos;
  const atual = precisaLer
    ? await metaReq<{ targeting?: Record<string, unknown>; daily_budget?: string }>(
        'GET', `/${conjuntoId}?fields=targeting,daily_budget`, accessToken,
      )
    : {};

  // Em campanha CBO o conjunto não tem daily_budget, e mandar um faz o Meta
  // recusar a atualização INTEIRA — o público revisado se perdia junto. O
  // orçamento ali é o da campanha; aqui só se ignora.
  if (dados.orcamentoDiarioCentavos && atual.daily_budget) {
    body.daily_budget = dados.orcamentoDiarioCentavos;
  }

  if (dados.publico) {
    const r = aplicarPublico(atual.targeting ?? {}, dados.publico);
    if (r.mudou) {
      body.targeting = r.targeting;
      advantageDesligado = r.advantageDesligado;
    }
  }

  if (!Object.keys(body).length) return { advantageDesligado: false };   // nada mudou
  await metaReq('POST', `/${conjuntoId}`, accessToken, body);
  return { advantageDesligado };
}

export interface RecriarConjuntoOpcoes {
  status:                   'ACTIVE' | 'PAUSED';
  /** Sufixo no nome, para diferenciar do original no Ads Manager. */
  sufixo?:                  string;
  /** Nome completo do conjunto novo; tem prioridade sobre `sufixo`. */
  nome?:                    string;
  orcamentoDiarioCentavos?: number;
  dataInicio?:              string;
  dataFim?:                 string | null;
  publico?: PublicoRevisado;
}

/**
 * Cria um conjunto NOVO com a mesma configuração de um existente, lendo os
 * campos do original. Usado quando o `/copies` do Meta recusa a cópia.
 *
 * A diferença que importa: a `attribution_spec` NÃO é copiada. O `/copies`
 * arrasta a janela de atribuição do original e a revalida — conjuntos antigos
 * guardam uma janela que a meta de otimização deles já não aceita (o original
 * segue rodando porque o Meta só valida na escrita), e a cópia morre com
 * "erro 100 — os valores suportados são uma janela de 1 dia". Omitindo o campo,
 * o Meta aplica a janela padrão válida para a meta de otimização.
 *
 * Não se perde nada com isso: uma cópia do Meta também nasce sem histórico —
 * conjunto novo é sempre fase de aprendizado nova.
 *
 * O targeting do original é reaproveitado, mas passa pelo `normalizarTargeting`;
 * se ainda assim for recusado, tenta uma vez sem os posicionamentos (Advantage+)
 * e avisa por `placementsAutomaticos`.
 */
export async function recriarConjunto(
  accessToken:      string,
  adAccountId:      string,
  conjuntoOrigemId: string,
  opcoes:           RecriarConjuntoOpcoes,
): Promise<{ conjuntoId: string; placementsAutomaticos: boolean; advantageDesligado: boolean }> {
  const CAMPOS = 'name,campaign_id,optimization_goal,billing_event,bid_strategy,bid_amount,'
    + 'destination_type,promoted_object,targeting,daily_budget,start_time,end_time';

  const origem = await metaReq<{
    name?: string; campaign_id?: string; optimization_goal?: string; billing_event?: string;
    bid_strategy?: string; bid_amount?: string; destination_type?: string;
    promoted_object?: Record<string, unknown>; targeting?: Record<string, unknown>;
    daily_budget?: string; start_time?: string; end_time?: string;
  }>('GET', `/${conjuntoOrigemId}?fields=${CAMPOS}`, accessToken);

  if (!origem.campaign_id) throw new Error('Não consegui ler a campanha do conjunto de origem.');

  let targeting: Record<string, unknown> = { ...(origem.targeting ?? {}) };
  let advantageDesligado = false;
  if (opcoes.publico) {
    const r = aplicarPublico(targeting, opcoes.publico);
    targeting = r.targeting;
    advantageDesligado = r.advantageDesligado;
  }
  const targetingFiel = normalizarTargeting(targeting);

  const body: Record<string, unknown> = {
    name:              (opcoes.nome || `${origem.name ?? 'Conjunto'}${opcoes.sufixo ?? ''}`).slice(0, 100),
    campaign_id:       origem.campaign_id,
    optimization_goal: origem.optimization_goal,
    billing_event:     origem.billing_event,
    bid_strategy:      origem.bid_strategy,
    targeting:         targetingFiel,
    status:            opcoes.status,
  };

  // Orçamento no conjunto só existe quando a campanha NÃO usa CBO — com CBO o
  // original vem sem daily_budget e mandar um aqui seria recusado.
  const orcamento = opcoes.orcamentoDiarioCentavos ?? Number(origem.daily_budget ?? 0);
  if (origem.daily_budget && orcamento) body.daily_budget = orcamento;

  // bid_amount só faz sentido nas estratégias com teto/meta de custo.
  if (origem.bid_amount && origem.bid_strategy && origem.bid_strategy !== 'LOWEST_COST_WITHOUT_CAP') {
    body.bid_amount = Number(origem.bid_amount);
  }
  // Click-to-WhatsApp e conversões dependem desses dois para o Meta aceitar o conjunto.
  if (origem.destination_type) body.destination_type = origem.destination_type;
  if (origem.promoted_object)  body.promoted_object  = origem.promoted_object;

  const inicio = opcoes.dataInicio ? `${opcoes.dataInicio}T00:00:00-0300` : origem.start_time;
  if (inicio) body.start_time = inicio;
  if (opcoes.dataFim) body.end_time = `${opcoes.dataFim}T23:59:59-0300`;

  try {
    const res = await metaReq<{ id: string }>('POST', `/${adAccountId}/adsets`, accessToken, body);
    return { conjuntoId: res.id, placementsAutomaticos: false, advantageDesligado };
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === 'META_TOKEN_EXPIRADO') throw e;

    // Última tentativa: o targeting antigo pode ter outras combinações de
    // posicionamento que o Meta não aceita mais. Sem esses campos ele usa
    // Advantage+ (escolhe os posicionamentos sozinho) e o resto do público —
    // idade, gênero, geolocalização — continua igual ao do original.
    const semPlacement = semPlacements(targetingFiel);
    const mudou = Object.keys(semPlacement).length !== Object.keys(targetingFiel).length;
    if (!mudou) throw e;

    try {
      const res = await metaReq<{ id: string }>(
        'POST', `/${adAccountId}/adsets`, accessToken, { ...body, targeting: semPlacement },
      );
      return { conjuntoId: res.id, placementsAutomaticos: true, advantageDesligado };
    } catch (e2) {
      // O erro que interessa ao gestor é o primeiro — sem posicionamento a
      // recusa costuma ser de outra coisa, e mostrar a segunda confunde.
      console.error('[Meta API] Recriar conjunto sem placements também falhou:', (e2 as Error).message);
      throw e;
    }
  }
}

export interface DuplicarConjuntoOpcoes {
  /** true = copia também os anúncios de dentro do conjunto. */
  comAnuncios: boolean;
  /** PAUSED evita que a cópia comece a gastar antes do gestor revisar. */
  status:      'PAUSED' | 'ACTIVE' | 'INHERITED_FROM_SOURCE';
  /** Campanha de destino. Vazio = duplica dentro da mesma campanha. */
  campanhaDestinoId?: string;
  /** Sufixo no nome da cópia, para diferenciar do original no Ads Manager. */
  sufixo?: string;
}

/**
 * Duplica um conjunto usando o endpoint nativo POST /<adset_id>/copies.
 * Devolve o id do conjunto criado.
 */
export async function duplicarConjunto(
  accessToken: string,
  conjuntoId:  string,
  opcoes:      DuplicarConjuntoOpcoes,
): Promise<{ conjuntoId: string; anunciosCopiados: number }> {
  const body: Record<string, unknown> = {
    deep_copy:     opcoes.comAnuncios,
    status_option: opcoes.status,
  };

  if (opcoes.campanhaDestinoId) body.campaign_id = opcoes.campanhaDestinoId;
  if (opcoes.sufixo) {
    // DEEP_RENAME renomeia também os anúncios copiados, não só o conjunto.
    body.rename_options = {
      rename_strategy: opcoes.comAnuncios ? 'DEEP_RENAME' : 'ONLY_TOP_LEVEL_RENAME',
      rename_suffix:   opcoes.sufixo,
    };
  }

  const res = await metaReq<{
    copied_adset_id?: string;
    ad_object_ids?:   Array<{ copied_id?: string }>;
  }>('POST', `/${conjuntoId}/copies`, accessToken, body);

  if (!res.copied_adset_id) {
    throw new Error('O Meta não retornou o conjunto duplicado.');
  }

  return {
    conjuntoId:       res.copied_adset_id,
    anunciosCopiados: res.ad_object_ids?.length ?? 0,
  };
}
