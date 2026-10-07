import type { FastifyInstance } from 'fastify';
import { Controller } from '../compartilhado/Controller';
import type { Autenticador } from './Autenticador';
import type { AuthService, DadosSuperAdmin } from './AuthService';
import type { TokenSessao } from './TokenSessao';
import type { TransporteSessao } from './TransporteSessao';

/** Rotas HTTP de /api/auth (login, logout, sessão atual, primeiro admin). */
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
    app.post('/api/auth/criar-super-admin', async (request, reply) => {
      const admin = await this.service.criarSuperAdmin(request.body as DadosSuperAdmin);
      return reply.code(201).send({ id: admin.id, nome: admin.nome, email: admin.email, is_admin: true });
    });

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
