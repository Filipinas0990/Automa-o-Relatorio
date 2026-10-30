import type { FastifyInstance } from 'fastify';
import { Controller } from '../compartilhado/Controller';
import type { Autenticador } from './Autenticador';
import type { AuthService } from './AuthService';
import type { TokenSessao } from './TokenSessao';
import type { TransporteSessao } from './TransporteSessao';

/**
 * Rotas HTTP de /api/auth (login, logout, sessão atual).
 *
 * De propósito SEM rota de autocadastro: software empresarial não tem via
 * pública de criação de conta, nem como bootstrap. Gestor novo é cadastrado
 * por um admin já logado, em POST /api/gestores (ver GestorController).
 */
export class AuthController extends Controller {
  constructor(
    private readonly service: AuthService,
    private readonly auth: Autenticador,
    private readonly tokens: TokenSessao,
    private readonly transporte: TransporteSessao,
  ) {
    super();
  }

  protected rotas(app: FastifyInstance): void {
    app.post('/api/auth/login', async (request, reply) => {
      const body = request.body as Record<string, string>;
      const gestor = await this.service.login(body.username || body.email, body.password || body.senha);
      // O token vai só no cookie httpOnly — fora do corpo, o JavaScript da página nunca o vê
      this.transporte.gravar(reply, this.tokens.emitir(gestor));
      return { id: gestor.id, nome: gestor.nome, email: gestor.email, is_admin: gestor.isAdmin };
    });

    app.post('/api/auth/logout', async (_request, reply) => {
      this.transporte.apagar(reply);
      return { mensagem: 'Sessão encerrada' };
    });

    app.get('/api/auth/me', { preHandler: this.auth.autenticar }, async (request) => {
      const g = request.user;
      return { id: g.id, nome: g.nome, email: g.email, is_admin: g.isAdmin };
    });
  }
}
