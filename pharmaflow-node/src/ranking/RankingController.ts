import type { FastifyInstance } from 'fastify';
import { Controller } from '../compartilhado/Controller';
import type { Autenticador } from '../auth/Autenticador';
import type { RankingService } from './RankingService';

/** Rotas HTTP de /api/ranking/gestores. */
export class RankingController extends Controller {
  constructor(
    private readonly service: RankingService,
    private readonly auth: Autenticador,
  ) {
    super();
  }

  protected rotas(app: FastifyInstance): void {
    const { autenticar } = this.auth;

    app.get('/api/ranking/gestores', { preHandler: autenticar }, async (request) => {
      return this.service.doMes((request.query as { mes?: string }).mes);
    });

    app.get('/api/ranking/gestores/historico', { preHandler: autenticar }, async () => {
      return this.service.historico();
    });
  }
}
