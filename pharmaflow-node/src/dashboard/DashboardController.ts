import type { FastifyInstance } from 'fastify';
import { Controller } from '../compartilhado/Controller';
import type { Autenticador } from '../auth/Autenticador';
import type { DashboardService } from './DashboardService';

/** Rotas HTTP de /api/dashboard. */
export class DashboardController extends Controller {
  constructor(
    private readonly service: DashboardService,
    private readonly auth: Autenticador,
  ) {
    super();
  }

  protected rotas(app: FastifyInstance): void {
    const comAuth = { preHandler: this.auth.autenticar };

    /** Séries de vendas de 7 e 30 dias (gráfico de linha/barra). */
    app.get('/api/dashboard/evolucao', comAuth, async (request) => {
      return this.service.evolucao(request.user, (request.query as { gestor_id?: string }).gestor_id);
    });

    /** Reuniões canceladas: donut, ranking por farmácia e evolução mensal. */
    app.get('/api/dashboard/reunioes-perda', comAuth, async (request) => {
      return this.service.reunioesPerdidas(request.user);
    });
  }
}
