// Qual token do Meta usar em cada pedido.
//
// Gestor que conectou o próprio Facebook publica e lista contas com o token
// DELE: o anúncio sai em nome dele, ele só enxerga o que o Facebook dele
// acessa, e aceites pessoais (ex.: Termos de Público Personalizado) valem.
// Quem não conectou segue com o META_ACCESS_TOKEN geral (usuário de sistema
// do BM) — decisão do dono em 07/10/2026, para ninguém parar na transição.

import { decrypt } from '../cripto';
import { logger } from '../logger';

export interface TokenMeta {
  token:   string;
  /** true = token do próprio gestor; false = token geral do servidor. */
  proprio: boolean;
}

interface GestorComMeta {
  id?:                number;
  metaAccessToken?:   string | null;
  metaTokenExpiraEm?: Date | string | null;
}

export function tokenGeral(): string {
  const t = process.env.META_ACCESS_TOKEN ?? '';
  if (!t) throw new Error('META_ACCESS_TOKEN não configurado no servidor.');
  return t;
}

/** Token do gestor, se conectado e dentro da validade; senão o geral. */
export function tokenMetaDo(gestor?: GestorComMeta | null): TokenMeta {
  if (gestor?.metaAccessToken) {
    const expira = gestor.metaTokenExpiraEm ? new Date(gestor.metaTokenExpiraEm) : null;
    if (!expira || expira.getTime() > Date.now()) {
      try {
        return { token: decrypt(gestor.metaAccessToken), proprio: true };
      } catch (e) {
        // Chave trocada ou dado corrompido: cai no geral em vez de travar o gestor.
        logger.warn({ gestor: gestor.id, err: (e as Error).message }, 'Token Meta do gestor ilegível — usando o geral');
      }
    }
  }
  return { token: tokenGeral(), proprio: false };
}

/** Mensagem de token expirado certa para cada caso. */
export function msgTokenExpirado(proprio: boolean): string {
  return proprio
    ? 'Sua conexão com o Facebook expirou ou foi revogada. Reconecte em Configurações → Facebook e tente de novo.'
    : 'Token do Meta expirado ou inválido. Gere um novo e atualize o servidor.';
}
