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
  orcamentoDiario: number;   // em reais (o Meta devolve centavos como string)
  otimizacao:      string;
  idadeMin:        number | null;
  idadeMax:        number | null;
  genero:          'todos' | 'homens' | 'mulheres';
  generos:         string;   // rótulo legível do campo acima
  /** destination_type = WHATSAPP → os anúncios novos precisam do mesmo CTA. */
  destinoWhatsapp: boolean;
  dataInicio:      string;   // YYYY-MM-DD ("" se não houver)
  dataFim:         string;   // YYYY-MM-DD ("" = sem término)
}

// Meta: genders [1]=homens, [2]=mulheres, ausente/ambos = todos
const GENERO = (g?: number[]): 'todos' | 'homens' | 'mulheres' => {
  if (!g?.length || g.length > 1) return 'todos';
  return g[0] === 1 ? 'homens' : 'mulheres';
};

const GENERO_LEGIVEL: Record<string, string> = {
  todos: 'Todos', homens: 'Homens', mulheres: 'Mulheres',
};

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
    + 'destination_type,start_time,end_time,campaign{name}';
  const res = await metaReq<{
    data?: Array<{
      id: string; name?: string; effective_status?: string;
      daily_budget?: string; optimization_goal?: string; destination_type?: string;
      start_time?: string; end_time?: string;
      targeting?: { age_min?: number; age_max?: number; genders?: number[] };
      campaign?: { id?: string; name?: string };
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
        otimizacao:      a.optimization_goal ?? '',
        idadeMin:        a.targeting?.age_min ?? null,
        idadeMax:        a.targeting?.age_max ?? null,
        genero,
        generos:         GENERO_LEGIVEL[genero],
        destinoWhatsapp: a.destination_type === 'WHATSAPP',
        dataInicio:      soData(a.start_time),
        dataFim:         soData(a.end_time),
      };
    });
}

/**
 * Atualiza um conjunto existente. O targeting é MESCLADO com o atual — o Meta
 * substitui o objeto inteiro, então enviar só idade/gênero apagaria a
 * geolocalização e a chamada seria rejeitada.
 */
export async function atualizarConjunto(
  accessToken: string,
  conjuntoId:  string,
  dados: {
    nome?:                    string;
    orcamentoDiarioCentavos?: number;
    dataInicio?:              string;
    dataFim?:                 string | null;
    publico?: { genero: 'todos' | 'homens' | 'mulheres'; idadeMin: number; idadeMax: number };
  },
): Promise<void> {
  const body: Record<string, unknown> = {};

  if (dados.nome)                    body.name         = dados.nome.slice(0, 100);
  if (dados.orcamentoDiarioCentavos) body.daily_budget = dados.orcamentoDiarioCentavos;
  if (dados.dataInicio)              body.start_time   = `${dados.dataInicio}T00:00:00-0300`;
  if (dados.dataFim)                 body.end_time     = `${dados.dataFim}T23:59:59-0300`;

  if (dados.publico) {
    const atual = await metaReq<{ targeting?: Record<string, unknown> }>(
      'GET', `/${conjuntoId}?fields=targeting`, accessToken,
    );
    const GENEROS_META: Record<string, number[]> = {
      todos: [1, 2], homens: [1], mulheres: [2],
    };
    body.targeting = {
      ...(atual.targeting ?? {}),
      age_min: dados.publico.idadeMin,
      age_max: dados.publico.idadeMax,
      genders: GENEROS_META[dados.publico.genero] ?? [1, 2],
    };
  }

  if (!Object.keys(body).length) return;   // nada mudou
  await metaReq('POST', `/${conjuntoId}`, accessToken, body);
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
