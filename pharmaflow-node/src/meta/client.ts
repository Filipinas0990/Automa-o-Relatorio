// Cliente base para a Meta Marketing API (Graph API v20)

const GRAPH_URL = 'https://graph.facebook.com/v20.0';

export const ERRO_ANUNCIANTE_VERIFICADO =
  'Esta conta exige anunciante verificado para criar conjuntos novos, e o Meta só permite informá-lo pelo Gerenciador de Anúncios.';

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
    // Conta com verificação de anunciante: conjunto NOVO exige o id do
    // anunciante verificado (regional_regulation_identities), e o Meta não tem
    // endpoint público para obtê-lo — só o Gerenciador tem. Não há o que mandar
    // diferente daqui; o gestor precisa saber o caminho que funciona.
    // Conjunto com lista de clientes (público personalizado) exige os termos de
    // Público Personalizado aceitos NA CONTA para quem chama a API — o usuário
    // de sistema do token, não o gestor que aceitou no Gerenciador. Não existe
    // endpoint para aceitar: é um clique de um admin no link que o Meta manda.
    const linkTermos = /https:\/\/business\.facebook\.com\/ads\/manage\/customaudiences\/tos\/\?act=\d+/
      .exec(`${json.error.error_user_msg ?? ''} ${json.error.message ?? ''}`)?.[0];
    if (linkTermos) {
      console.error('[Meta API]', JSON.stringify({ path, error: json.error }));
      throw new Error(
        'Esta conta de anúncios ainda não aceitou os Termos de Público Personalizado para o acesso do sistema, '
        + 'e o conjunto usa lista de clientes (ex.: "Contatos Salvos"). Um administrador da conta no Business Manager '
        + `precisa abrir ${linkTermos}, aceitar os termos e depois publicar de novo.`,
      );
    }
    // Página com WhatsApp PESSOAL ligado: anúncio para WhatsApp exige número do
    // WhatsApp Business. O conjunto não guarda número — usa o da página —, então
    // só se resolve na página (Configurações → Contas vinculadas → WhatsApp).
    // Checkpoint de segurança do Facebook na conta do dono do token (#31,
    // subcódigo 3858385): bloqueia criar/editar anúncios até ele se autenticar
    // no Gerenciador. Os anúncios que já rodam continuam. Nada a fazer pela API.
    if (json.error.code === 31 || json.error.error_subcode === 3858385) {
      console.error('[Meta API]', JSON.stringify({ path, error: json.error }));
      throw new Error(
        'O Facebook bloqueou a criação de anúncios nesta conta por segurança (suspeita de acesso indevido). '
        + 'O dono do Facebook conectado precisa abrir o Gerenciador de Anúncios (adsmanager.facebook.com), '
        + 'confirmar a identidade quando for pedido e depois publicar de novo. Os anúncios que já rodam não param.',
      );
    }
    // Token emitido por app do Meta em MODO DE DESENVOLVIMENTO: o Meta cria o
    // criativo mas recusa publicar o anúncio. Só se resolve no app (modo Ao vivo).
    const textoErro = `${json.error.error_user_msg ?? ''} ${json.error.message ?? ''}`;
    if (/modo de desenvolvimento|development mode/i.test(textoErro)) {
      console.error('[Meta API]', JSON.stringify({ path, error: json.error }));
      throw new Error(
        'O app do Facebook que gerou este token está em modo de desenvolvimento, e o Meta não publica anúncios feitos por ele. '
        + 'Em developers.facebook.com, abra o app e mude o modo para "Ao vivo" (Live). Depois publique de novo.',
      );
    }
    if (json.error.error_subcode === 2446885) {
      console.error('[Meta API]', JSON.stringify({ path, error: json.error }));
      throw new Error(
        'O WhatsApp ligado à página deste cliente é uma conta pessoal, e o Meta só aceita anúncio para WhatsApp Business. '
        + 'Na página do Facebook, vá em Configurações → Contas vinculadas → WhatsApp e conecte um número do WhatsApp Business '
        + '(pode ser o mesmo número, migrado para o app WhatsApp Business). Depois publique de novo.',
      );
    }
    if (json.error.error_subcode === 3858634) {
      console.error('[Meta API]', JSON.stringify({ path, error: json.error }));
      throw new Error(ERRO_ANUNCIANTE_VERIFICADO);
    }
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

export interface LocalizacaoMeta {
  key:    string;   // ex: "2450022" — chave interna do Meta, exigida pelo geo_locations
  nome:   string;   // ex: "São Paulo"
  regiao: string;   // ex: "São Paulo" (estado)
}

/**
 * Busca cidades brasileiras na Graph API (mesmo mecanismo que o Gerenciador de
 * Anúncios usa pro autocomplete de localização). O Meta não aceita nome de
 * cidade em texto puro no targeting — precisa dessa "key".
 */
export async function buscarLocalizacoes(accessToken: string, termo: string): Promise<LocalizacaoMeta[]> {
  const q = termo.trim();
  if (q.length < 2) return [];

  const path = `/search?type=adgeolocation&location_types=${encodeURIComponent('["city"]')}`
    + `&country_code=BR&q=${encodeURIComponent(q)}&limit=8`;

  const res = await metaReq<{ data?: Array<{ key: string; name: string; region?: string }> }>(
    'GET', path, accessToken,
  );

  return (res.data ?? []).map((d) => ({ key: d.key, nome: d.name, regiao: d.region ?? '' }));
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
