import type { FastifyInstance } from 'fastify';
import { Controller } from '../compartilhado/Controller';
import type { Autenticador } from '../auth/Autenticador';
import type { DesempenhoService, FiltrosDesempenho } from './DesempenhoService';

/** Rota HTTP do painel geral (/api/painel). */
export class PainelController extends Controller {
  constructor(
    private readonly desempenho: DesempenhoService,
    private readonly auth: Autenticador,
  ) {
    super();
  }

  protected rotas(app: FastifyInstance): void {
    app.get('/api/painel', { preHandler: this.auth.autenticar }, async (request) => {
      return this.desempenho.painel(request.user, request.query as FiltrosDesempenho);
    });
  }
}
