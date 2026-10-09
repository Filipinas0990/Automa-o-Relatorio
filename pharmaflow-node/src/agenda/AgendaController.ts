import type { FastifyInstance } from 'fastify';
import { Controller } from '../compartilhado/Controller';
import type { Autenticador } from '../auth/Autenticador';
import type { AgendaService, DadosBloqueio } from './AgendaService';

type Query = Record<string, string | undefined>;

/** Rotas HTTP de /api/agenda. */
export class AgendaController extends Controller {
  constructor(
    private readonly service: AgendaService,
    private readonly auth: Autenticador,
  ) {
    super();
  }

  protected rotas(app: FastifyInstance): void {
    const { autenticar, apenasAdmin } = this.auth;

    /** ?data=2026-06-05&hora=14:00&duracao=60 */
    app.get('/api/agenda/disponibilidade', { preHandler: autenticar }, async (request) => {
      return this.service.disponibilidade(request.query as Query);
    });

    /** ?mes=2026-06 */
    app.get('/api/agenda/calendario', { preHandler: autenticar }, async (request) => {
      return this.service.calendario((request.query as Query).mes);
    });

    /** ?data=2026-06-05T14:00:00Z&duracao=60&reuniao_id=5 */
    app.get('/api/agenda/verificar', { preHandler: autenticar }, async (request) => {
      return this.service.verificar(request.query as Query);
    });

    app.get('/api/agenda/bloqueios', { preHandler: autenticar }, async (request) => {
      return this.service.listarBloqueios((request.query as Query).mes);
    });

    app.post('/api/agenda/bloqueios', { preHandler: [autenticar, apenasAdmin] }, async (request, reply) => {
      return reply.code(201).send(await this.service.bloquear(request.body as DadosBloqueio, request.user));
    });

    app.delete('/api/agenda/bloqueios/:id', { preHandler: [autenticar, apenasAdmin] }, async (request) => {
      await this.service.desbloquear(parseInt((request.params as { id: string }).id, 10));
      return { mensagem: 'Bloqueio removido.' };
    });
  }
}
