import type { FastifyInstance } from 'fastify';
import { Controller } from '../compartilhado/Controller';
import type { Autenticador } from '../auth/Autenticador';
import type { ConexaoMetaService } from './ConexaoMetaService';

/** Rotas HTTP de /api/auth/meta (conectar o Facebook do gestor). */
export class ConexaoMetaController extends Controller {
  constructor(
    private readonly service: ConexaoMetaService,
    private readonly auth: Autenticador,
    private readonly frontendUrl: string,
  ) {
    super();
  }

  protected rotas(app: FastifyInstance): void {
    const { autenticar } = this.auth;

    app.get('/api/auth/meta/url', { preHandler: autenticar }, async (request) => {
      return { url: this.service.urlDeAutorizacao(request.user.id) };
    });

    app.get('/api/auth/meta/callback', async (request, reply) => {
      const status = await this.service.conectarPorCodigo(request.query as Record<string, string>);
      return reply.redirect(`${this.frontendUrl}/configuracoes?meta=${status}`);
    });

    app.post('/api/auth/meta/token', { preHandler: autenticar }, async (request) => {
      const token = (request.body as { token?: string } | undefined)?.token ?? '';
      return this.service.conectarPorToken(request.user.id, String(token));
    });

    app.get('/api/auth/meta/status', { preHandler: autenticar }, async (request) => {
      return this.service.status(request.user);
    });

    app.delete('/api/auth/meta', { preHandler: autenticar }, async (request) => {
      await this.service.desconectar(request.user.id);
      return { mensagem: 'Facebook desconectado. Você volta a publicar com o acesso geral da agência.' };
    });
  }
}
