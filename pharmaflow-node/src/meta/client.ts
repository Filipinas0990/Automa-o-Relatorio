// Cliente base para a Meta Marketing API (Graph API v20)

const GRAPH_URL = 'https://graph.facebook.com/v20.0';

export async function metaReq<T = unknown>(
  method:      string,
  path:        string,
  accessToken: string,
  body?:       Record<string, unknown>,
): Promise<T> {
  const url = new URL(`${GRAPH_URL}${path}`);

  if (method === 'GET') {
    url.searchParams.set('access_token', accessToken);
    if (body) {
      for (const [k, v] of Object.entries(body)) {
        url.searchParams.set(k, String(v));
      }
    }
  }

  const res = await fetch(url.toString(), {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method !== 'GET' ? JSON.stringify({ ...body, access_token: accessToken }) : undefined,
  });

  const json = await res.json() as {
    error?: {
      message:        string;
      code:           number;
      error_subcode?: number;
      error_user_msg?: string;
      error_user_title?: string;
      fbtrace_id?:    string;
    };
  } & T;

  if (json.error) {
    if (json.error.code === 190) throw new Error('META_TOKEN_EXPIRADO');
    const detail = json.error.error_user_msg ?? json.error.error_user_title ?? '';
    const msg = `Meta API error [${json.error.code}]: ${json.error.message}${detail ? ` — ${detail}` : ''}`;
    // Log completo para debug
    console.error('[Meta API]', JSON.stringify({ path, body: { ...body, access_token: '***' }, error: json.error }));
    throw new Error(msg);
  }

  return json;
}

// Mapa de account_status da Meta → rótulo legível
const STATUS_CONTA: Record<number, string> = {
  1: 'Ativa',
  2: 'Desativada',
  3: 'Não confirmada',
  7: 'Em análise',
  9: 'Em período de graça',
  101: 'Fechada',
};

export interface ContaAnuncio {
  id:            string;   // "act_123456789"
  accountId:     string;   // "123456789"
  nome:          string;   // nome da conta de anúncio
  cliente:       string;   // nome do Business Manager dono (quando disponível)
  moeda:         string;   // "BRL"
  status:        string;   // rótulo legível
  ativa:         boolean;
  temPagamento:  boolean;  // tem forma de pagamento configurada
  formaPagamento: string;  // ex: "Saldo disponível (R$816,04 BRL)" ou "" (nenhuma)
}

/**
 * Lista TODAS as contas de anúncios que o token tem acesso (System User do BM).
 * Segue a paginação da Graph API até acabar.
 */
export async function listarContasDeAnuncio(accessToken: string): Promise<ContaAnuncio[]> {
  const contas: ContaAnuncio[] = [];
  const FIELDS = 'name,account_id,account_status,currency,business{name},funding_source_details{display_string}';
  let path: string | null = `/me/adaccounts?fields=${FIELDS}&limit=100`;

  // Segue as páginas (paging.next) até não haver mais
  while (path) {
    const res: {
      data?: Array<{
        id: string;
        account_id: string;
        name?: string;
        account_status?: number;
        currency?: string;
        business?: { name?: string };
        funding_source_details?: { display_string?: string };
      }>;
      paging?: { next?: string; cursors?: { after?: string } };
    } = await metaReq('GET', path, accessToken);

    for (const c of res.data ?? []) {
      const forma = c.funding_source_details?.display_string ?? '';
      contas.push({
        id:            c.id,
        accountId:     c.account_id,
        nome:          c.name ?? `Conta ${c.account_id}`,
        cliente:       c.business?.name ?? '',
        moeda:         c.currency ?? '',
        status:        STATUS_CONTA[c.account_status ?? -1] ?? 'Desconhecido',
        ativa:         c.account_status === 1,
        temPagamento:  !!c.funding_source_details,
        formaPagamento: forma,
      });
    }

    // Próxima página via cursor (mantém o mesmo path base)
    const after = res.paging?.next ? res.paging?.cursors?.after : undefined;
    path = after ? `/me/adaccounts?fields=${FIELDS}&limit=100&after=${after}` : null;
  }

  return contas;
}

/**
 * Verifica se o token está válido e retorna quantos dias restam.
 * Chame em /api/ads/token-status para exibir no painel de configurações.
 */
export async function verificarTokenMeta(accessToken: string): Promise<{
  valido:     boolean;
  expiraEm:   Date | null;
  diasRestantes: number | null;
  erro?:      string;
}> {
  try {
    const res = await fetch(
      `${GRAPH_URL}/debug_token?input_token=${accessToken}&access_token=${accessToken}`,
    );
    const json = await res.json() as {
      data?: {
        is_valid:   boolean;
        expires_at: number;   // unix timestamp (0 = nunca expira)
        error?: { message: string };
      };
      error?: { message: string };
    };

    if (!json.data || json.error) {
      return { valido: false, expiraEm: null, diasRestantes: null, erro: json.error?.message ?? 'Token inválido' };
    }

    const { is_valid, expires_at } = json.data;

    if (!is_valid) {
      return { valido: false, expiraEm: null, diasRestantes: null, erro: 'Token inválido ou expirado' };
    }

    // expires_at = 0 significa "nunca expira" (System User Token)
    if (!expires_at) {
      return { valido: true, expiraEm: null, diasRestantes: null };
    }

    const expiraEm = new Date(expires_at * 1000);
    const diasRestantes = Math.floor((expiraEm.getTime() - Date.now()) / 86_400_000);

    return { valido: true, expiraEm, diasRestantes };
  } catch {
    return { valido: false, expiraEm: null, diasRestantes: null, erro: 'Erro ao verificar token' };
  }
}
