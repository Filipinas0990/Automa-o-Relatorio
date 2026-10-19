import type { FastifyInstance } from 'fastify';
import { Controller } from '../compartilhado/Controller';
import type { Autenticador } from '../auth/Autenticador';
import type { CustoResultadoService } from './CustoResultadoService';

/** Rotas HTTP de /api/custo-resultado. */
export class CustoResultadoController extends Controller {
  constructor(
    private readonly service: CustoResultadoService,
    private readonly auth: Autenticador,
  ) {
    super();
  }

  protected rotas(app: FastifyInstance): void {
    const { autenticar, apenasAdmin } = this.auth;

    /** Custo por resultado (7, 15 e 30 dias) de cada farmácia. Admin pode filtrar por gestor. */
    app.get('/api/custo-resultado', { preHandler: autenticar }, async (request) => {
      return this.service.listar(request.user, (request.query as { gestor_id?: string }).gestor_id);
    });

    /**
     * Contas de anúncios para o cadastro da farmácia (só admin, como o
     * cadastro). `farmacia_id` traz também a conta sugerida pelo nome.
     * Consulta o Meta na hora com o token de cada gestor conectado.
     */
    app.get('/api/custo-resultado/contas', { preHandler: [autenticar, apenasAdmin] }, async (request) => {
      const id = parseInt((request.query as { farmacia_id?: string }).farmacia_id ?? '', 10);
      return this.service.contasDisponiveis(Number.isFinite(id) ? id : undefined);
    });

    /**
     * Força uma rodada agora (o job normal é o das 06:00). Só admin: percorre
     * todas as contas e consome o limite de requisições do Meta. Responde na
     * hora; a rodada segue em segundo plano.
     */
    app.post('/api/custo-resultado/sincronizar', { preHandler: [autenticar, apenasAdmin] }, async (_request, reply) => {
      this.service.sincronizarTodas().catch(() => { /* já logado dentro do serviço */ });
      return reply.code(202).send({ detail: 'Sincronização iniciada' });
    });
  }
}
