import type { FastifyInstance } from 'fastify';
import { Controller } from '../compartilhado/Controller';
import { Indisponivel } from '../compartilhado/erros';
import { logger } from '../logger';
import type { Autenticador } from '../auth/Autenticador';
import type { StateOAuth } from '../auth/StateOAuth';
import type { GestorRepository } from '../gestores/GestorRepository';
import type { ClienteGoogleOAuth } from './ClienteGoogleOAuth';

/**
 * Conexão do Google Calendar do gestor (/api/auth/google).
 *
 * O fluxo começa de dois jeitos:
 *  1. GET /api/auth/google/url  (fetch autenticado) → devolve { url }
 *  2. GET /api/auth/google      (window.location.href, sessão pelo cookie) → redireciona direto
 */
export class GoogleController extends Controller {
  constructor(
    private readonly cliente: ClienteGoogleOAuth,
    private readonly state: StateOAuth,
    private readonly gestores: GestorRepository,
    private readonly auth: Autenticador,
    private readonly frontendUrl: string,
  ) {
    super();
  }

  protected rotas(app: FastifyInstance): void {
    const { autenticar } = this.auth;

    app.get('/api/auth/google/url', { preHandler: autenticar }, async (request) => {
      return { url: this.urlDeAutorizacao(request.user.id) };
    });

    app.get('/api/auth/google', { preHandler: autenticar }, async (request, reply) => {
      return reply.redirect(this.urlDeAutorizacao(request.user.id));
    });

    /** Volta do Google depois da autorização: sempre redireciona para a tela de reuniões. */
    app.get('/api/auth/google/callback', async (request, reply) => {
      if (!this.cliente.configurado) throw new Indisponivel('Google não configurado.');
      const voltar = (status: string) => reply.redirect(`${this.frontendUrl}/reunioes?google=${status}`);

      const { code, state, error } = request.query as Record<string, string>;
      if (error || !code || !state) return voltar('error');
      const gestorId = this.state.ler(state);
      if (!gestorId) return voltar('error');

      try {
        const refreshToken = await this.cliente.refreshTokenDoCodigo(code);
        if (!refreshToken) return voltar('already_connected');
        await this.gestores.atualizar(gestorId, { googleRefreshToken: refreshToken });
        return voltar('connected');
      } catch (e) {
        logger.error({ err: e }, 'Erro no callback Google OAuth');
        return voltar('error');
      }
    });

    app.get('/api/auth/google/status', { preHandler: autenticar }, async (request) => {
      const g = await this.gestores.buscarPorId(request.user.id);
      return { conectado: !!g?.googleRefreshToken, google_configurado: this.cliente.configurado };
    });

    app.delete('/api/auth/google', { preHandler: autenticar }, async (request) => {
      await this.gestores.atualizar(request.user.id, { googleRefreshToken: null });
      return { mensagem: 'Google Calendar desconectado.' };
    });
  }

  private urlDeAutorizacao(gestorId: number): string {
    if (!this.cliente.configurado) throw new Indisponivel('Google Calendar não configurado no servidor.');
    return this.cliente.urlDeAutorizacao(this.state.criar(gestorId));
  }
}
