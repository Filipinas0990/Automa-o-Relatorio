/**
 * Como a sessão viaja no HTTP — JWT dentro de um cookie httpOnly.
 *
 * O token não fica no localStorage: o JavaScript da página não consegue
 * lê-lo, então um script injetado (XSS) não tem como roubar a sessão. O front
 * fala com a API pela mesma origem (proxy da Vercel / proxy do vite), e o
 * navegador manda o cookie sozinho — inclusive em <img src> e EventSource,
 * que antes precisavam do token na URL.
 *
 * SameSite=Strict: o cookie não acompanha pedidos vindos de outro site, o que
 * fecha a porta para CSRF (um formulário de outro domínio postando aqui).
 * Sem Domain de propósito: o cookie fica preso ao domínio do front, que é onde
 * o navegador enxerga a resposta através do proxy.
 *
 * O header `Authorization: Bearer` continua aceito para scripts e testes.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { INATIVIDADE_SEG } from './TokenSessao';

export interface CredencialDoPedido {
  token: string;
  /** Quem manda Bearer cuida do próprio token — só o cookie é renovado. */
  origem: 'bearer' | 'cookie';
}

export class TransporteSessao {
  static readonly COOKIE = 'pf_sessao';

  gravar(reply: FastifyReply, token: string): void {
    reply.header(
      'Set-Cookie',
      `${TransporteSessao.COOKIE}=${token}; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=${INATIVIDADE_SEG}`,
    );
  }

  apagar(reply: FastifyReply): void {
    reply.header('Set-Cookie', `${TransporteSessao.COOKIE}=; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
  }

  /** Token do pedido: header Bearer (scripts/testes) ou cookie de sessão (navegador). Nunca pela URL. */
  lerDoPedido(request: FastifyRequest): CredencialDoPedido | null {
    const auth = request.headers.authorization || '';
    if (auth.startsWith('Bearer ')) return { token: auth.slice(7), origem: 'bearer' };
    const token = this.lerCookie(request);
    return token ? { token, origem: 'cookie' } : null;
  }

  private lerCookie(request: FastifyRequest): string | null {
    const cabecalho = request.headers.cookie;
    if (!cabecalho) return null;
    for (const parte of cabecalho.split(';')) {
      const i = parte.indexOf('=');
      if (i > 0 && parte.slice(0, i).trim() === TransporteSessao.COOKIE) return parte.slice(i + 1).trim() || null;
    }
    return null;
  }
}
