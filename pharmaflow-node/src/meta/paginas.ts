import { metaReq } from './client';
import { logger } from '../logger';

/**
 * Páginas do Facebook que uma conta de anúncios pode usar no criativo.
 *
 * Existe porque o criativo era montado com a PRIMEIRA página que o Business
 * Manager devolvesse (`owned_pages?limit=1`). Num BM de agência, com uma página
 * por farmácia, essa quase nunca era a página do cliente daquele anúncio — e a
 * Meta recusava com "As Páginas não correspondem" (#1885029).
 *
 * A conta do Instagram vem junto porque o criativo precisa dela: sem
 * `instagram_actor_id`, anúncio com posicionamento no Instagram é bloqueado com
 * "selecione uma conta do Instagram" (#1772103). Página sem Instagram vinculado
 * volta com `instagramId: null`, e a tela avisa o gestor antes de publicar.
 */
export interface PaginaMeta {
  id:           string;
  nome:         string;
  instagramId:  string | null;
  instagramNome: string | null;
}

interface PaginaBruta {
  id:   string;
  name?: string;
  instagram_business_account?: { id: string; username?: string };
}

const CAMPOS = 'id,name,instagram_business_account{id,username}';

function converter(p: PaginaBruta): PaginaMeta {
  return {
    id:            p.id,
    nome:          p.name ?? p.id,
    instagramId:   p.instagram_business_account?.id ?? null,
    instagramNome: p.instagram_business_account?.username ?? null,
  };
}

/**
 * Lista as páginas que a conta enxerga: as do Business Manager dono (próprias e
 * de clientes) e, como último recurso, as `promote_pages` da própria conta.
 * Sem duplicar — a mesma página costuma aparecer em mais de uma origem.
 */
export async function listarPaginasDaConta(
  accessToken: string,
  adAccountId: string,
): Promise<PaginaMeta[]> {
  const encontradas = new Map<string, PaginaMeta>();

  const coletar = async (path: string): Promise<void> => {
    try {
      const res = await metaReq<{ data?: PaginaBruta[] }>('GET', path, accessToken);
      for (const bruta of res.data ?? []) {
        if (!encontradas.has(bruta.id)) encontradas.set(bruta.id, converter(bruta));
      }
    } catch (e) {
      // Uma origem que falha não invalida as outras — o BM pode não expor
      // client_pages, por exemplo, e ainda assim ter owned_pages.
      logger.warn({ err: (e as Error).message, path }, 'Falha ao listar páginas');
    }
  };

  let businessId: string | null = null;
  try {
    const res = await metaReq<{ business?: { id: string } }>(
      'GET', `/${adAccountId}?fields=business`, accessToken,
    );
    businessId = res.business?.id ?? null;
  } catch (e) {
    logger.warn({ err: (e as Error).message }, 'Não consegui obter o business da conta');
  }

  if (businessId) {
    await coletar(`/${businessId}/owned_pages?fields=${CAMPOS}&limit=200`);
    await coletar(`/${businessId}/client_pages?fields=${CAMPOS}&limit=200`);
  }
  if (!encontradas.size) {
    await coletar(`/${adAccountId}/promote_pages?fields=${CAMPOS}&limit=200`);
  }

  return [...encontradas.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}
