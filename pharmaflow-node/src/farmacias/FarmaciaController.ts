import type { FastifyInstance } from 'fastify';
import { Controller } from '../compartilhado/Controller';
import type { Autenticador } from '../auth/Autenticador';
import type { DadosFarmacia, FarmaciaService } from './FarmaciaService';
import type { DesempenhoService, FiltrosDesempenho } from './DesempenhoService';

/** Rotas HTTP de /api/farmacias (cadastro, listagem e evolução). */
export class FarmaciaController extends Controller {
  constructor(
    private readonly cadastro: FarmaciaService,
    private readonly desempenho: DesempenhoService,
    private readonly auth: Autenticador,
  ) {
    super();
  }

  protected rotas(app: FastifyInstance): void {
    const { autenticar, apenasAdmin } = this.auth;
    const soAdmin = { preHandler: [autenticar, apenasAdmin] };

    app.get('/api/farmacias', { preHandler: autenticar }, async (request) => {
      return this.desempenho.listar(request.user, request.query as FiltrosDesempenho);
    });

    app.get('/api/farmacias/:id/evolucao', { preHandler: autenticar }, async (request) => {
      const { dias } = request.query as { dias?: string };
      return this.desempenho.evolucao(request.user, this.idDaRota(request.params), dias);
    });

    app.post('/api/farmacias', soAdmin, async (request, reply) => {
      const f = await this.cadastro.criar(request.body as DadosFarmacia);
      return reply.code(201).send({
        id:           f.id,
        nome:         f.nome,
        nome_fachada: f.nomeFachada,
        fase:         f.fase,
        gestor_id:    f.gestorId,
        tem_chatbot:  f.temChatbot,
      });
    });

    app.put('/api/farmacias/:id', soAdmin, async (request) => {
      const f = await this.cadastro.atualizar(this.idDaRota(request.params), request.body as DadosFarmacia);
      return { id: f.id, nome: f.nome, ativa: f.ativa };
    });

    app.patch('/api/farmacias/:id/meta', soAdmin, async (request) => {
      const f = await this.cadastro.atualizarMetas(this.idDaRota(request.params), request.body as DadosFarmacia);
      return {
        id: f.id, nome: f.nome,
        meta_vendas:       f.metaVendas,
        meta_receita:      f.metaReceita ? parseFloat(f.metaReceita) : null,
        meta_leads_google: f.metaLeadsGoogle ?? null,
        meta_leads_meta:   f.metaLeadsMeta   ?? null,
      };
    });

    app.delete('/api/farmacias/:id', soAdmin, async (request) => {
      await this.cadastro.desativar(this.idDaRota(request.params));
      return { mensagem: 'Farmácia desativada' };
    });

    app.patch('/api/farmacias/:id/ativar', soAdmin, async (request) => {
      const f = await this.cadastro.ativar(this.idDaRota(request.params), request.body as DadosFarmacia);
      return { id: f.id, nome: f.nome, fase: f.fase, gestor_id: f.gestorId, mensagem: 'Farmácia ativada com sucesso.' };
    });
  }

  private idDaRota(params: unknown): number {
    return parseInt((params as { id: string }).id, 10);
  }
}
