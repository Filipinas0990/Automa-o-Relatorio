import type { FastifyInstance } from 'fastify';
import type { Reuniao } from '../database/schema';
import { Controller } from '../compartilhado/Controller';
import type { Autenticador } from '../auth/Autenticador';
import { LinkAgendaGoogle } from '../google/LinkAgendaGoogle';
import type { CoberturaService } from './CoberturaService';
import type { FiltrosReuniao } from './ReuniaoRepository';
import type { DadosReuniao, ReuniaoService } from './ReuniaoService';

type Query = Record<string, string | undefined>;

/** Rotas HTTP de /api/reunioes. Toda reunião devolvida leva o `google_link` de "Adicionar à agenda". */
export class ReuniaoController extends Controller {
  constructor(
    private readonly reunioes: ReuniaoService,
    private readonly cobertura: CoberturaService,
    private readonly auth: Autenticador,
  ) {
    super();
  }

  protected rotas(app: FastifyInstance): void {
    const comAuth = { preHandler: this.auth.autenticar };

    app.get('/api/reunioes/stats', comAuth, async (request) => {
      return this.reunioes.estatisticas(request.user);
    });

    /** ?mes=YYYY-MM — farmácias com e sem reunião no mês */
    app.get('/api/reunioes/gerenciador-mensal', comAuth, async (request) => {
      return this.cobertura.doMes(request.user, (request.query as Query).mes);
    });

    /** ?meses=6 — cobertura mês a mês, para os gráficos */
    app.get('/api/reunioes/cobertura-mensal', comAuth, async (request) => {
      return this.cobertura.historico(request.user, (request.query as Query).meses);
    });

    app.get('/api/reunioes', comAuth, async (request) => {
      const linhas = await this.reunioes.listar(request.query as FiltrosReuniao);
      return linhas.map((r) => ({ ...r, google_link: LinkAgendaGoogle.daLinha(r as never) }));
    });

    app.post('/api/reunioes', comAuth, async (request, reply) => {
      const { reuniao, sincronizada } = await this.reunioes.criar(request.user, request.body as DadosReuniao);
      return reply.code(201).send({ ...this.comLink(reuniao), google_event_sincronizado: sincronizada });
    });

    app.get('/api/reunioes/:id', comAuth, async (request) => {
      const r = await this.reunioes.buscar(request.user, this.id(request.params));
      return { ...r, google_link: LinkAgendaGoogle.daLinha(r as never) };
    });

    app.put('/api/reunioes/:id', comAuth, async (request) => {
      return this.comLink(await this.reunioes.atualizar(request.user, this.id(request.params), request.body as DadosReuniao));
    });

    app.patch('/api/reunioes/:id/confirmar', comAuth, async (request) => {
      const id = this.id(request.params);
      await this.reunioes.confirmar(request.user, id);
      return { id, status: 'confirmada', mensagem: 'Reunião confirmada.' };
    });

    app.patch('/api/reunioes/:id/realizar', comAuth, async (request) => {
      const id = this.id(request.params);
      await this.reunioes.realizar(request.user, id, (request.body as { observacoes?: string } | undefined)?.observacoes);
      return { id, status: 'realizada', mensagem: 'Reunião marcada como realizada.' };
    });

    app.patch('/api/reunioes/:id/cancelar', comAuth, async (request) => {
      const id = this.id(request.params);
      await this.reunioes.cancelar(request.user, id);
      return { id, status: 'cancelada', mensagem: 'Reunião cancelada.' };
    });

    app.get('/api/reunioes/:id/google-link', comAuth, async (request) => {
      return { link: this.comLink(await this.reunioes.exigir(this.id(request.params))).google_link };
    });

    app.post('/api/reunioes/:id/sync-google', comAuth, async (request) => {
      const eventId = await this.reunioes.sincronizarGoogle(request.user, this.id(request.params));
      return { google_event_id: eventId, mensagem: 'Evento sincronizado com sucesso.' };
    });
  }

  private comLink(r: Reuniao) {
    return { ...r, google_link: LinkAgendaGoogle.gerar(r) };
  }

  private id(params: unknown): number {
    return parseInt((params as { id: string }).id, 10);
  }
}
