import type { FastifyInstance } from 'fastify';
import { Controller } from '../compartilhado/Controller';
import type { Autenticador } from '../auth/Autenticador';
import type { DadosGestor, GestorService } from './GestorService';

/** Rotas HTTP de /api/gestores. */
export class GestorController extends Controller {
  constructor(
    private readonly service: GestorService,
    private readonly auth: Autenticador,
  ) {
    super();
  }

  protected rotas(app: FastifyInstance): void {
    const { autenticar, apenasAdmin } = this.auth;

    app.get('/api/gestores', { preHandler: autenticar }, async (request) => {
      return this.service.listarVisiveisPara(request.user);
    });

    app.post('/api/gestores', { preHandler: [autenticar, apenasAdmin] }, async (request, reply) => {
      const { nome, email, senha } = request.body as Record<string, string>;
      const g = await this.service.criar({ nome, email, senha });
      return reply.code(201).send({ id: g.id, nome: g.nome, email: g.email });
    });

    app.put('/api/gestores/:id', { preHandler: [autenticar, apenasAdmin] }, async (request) => {
      const g = await this.service.atualizar(this.idDaRota(request.params), request.body as DadosGestor);
      return { id: g.id, nome: g.nome, email: g.email };
    });

    app.delete('/api/gestores/:id', { preHandler: [autenticar, apenasAdmin] }, async (request) => {
      await this.service.desativar(this.idDaRota(request.params), request.user);
      return { mensagem: 'Gestor desativado' };
    });
  }

  private idDaRota(params: unknown): number {
    return parseInt((params as { id: string }).id, 10);
  }
}
