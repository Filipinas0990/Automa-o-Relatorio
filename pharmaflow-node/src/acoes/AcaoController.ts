import type { FastifyInstance } from 'fastify';
import type { Acao } from '../database/schema';
import type { Linha } from '../compartilhado/tipos';
import { Controller } from '../compartilhado/Controller';
import type { Autenticador } from '../auth/Autenticador';
import type { FiltrosAcao } from './AcaoRepository';
import type { AcaoService, DadosAcao } from './AcaoService';

type Params = { id: string; farmaciaId?: string };
const int = (v: unknown) => parseInt(String(v || 0));
const idOuNull = (v: unknown) => (v ? parseInt(String(v)) : null);

/** Rotas HTTP de /api/acoes e das ações de uma farmácia. */
export class AcaoController extends Controller {
  constructor(
    private readonly service: AcaoService,
    private readonly auth: Autenticador,
  ) {
    super();
  }

  protected rotas(app: FastifyInstance): void {
    const { autenticar, apenasAdmin } = this.auth;
    const comAuth = { preHandler: autenticar };
    const soAdmin = { preHandler: [autenticar, apenasAdmin] };

    /** ?mes=YYYY-MM&status=&tipo= */
    app.get('/api/acoes', comAuth, async (request) => {
      const linhas = await this.service.listar(request.query as FiltrosAcao);
      return linhas.map((r) => ({
        ...this.cabecalho(r),
        criado_por_nome: r.criado_por_nome ?? null,
        criado_em:       r.criado_em,
        atualizado_em:   r.atualizado_em,
        total_farmacias: int(r.total_farmacias),
      }));
    });

    /** ?mes=YYYY-MM (padrão: mês atual) */
    app.get('/api/acoes/resumo', comAuth, async (request) => {
      return this.service.resumo((request.query as { mes?: string }).mes);
    });

    app.post('/api/acoes', soAdmin, async (request, reply) => {
      const a = await this.service.criar(request.body as DadosAcao, request.user);
      return reply.code(201).send({
        ...this.daTabela(a),
        criado_por_id:   a.criadoPorId,
        criado_em:       a.criadoEm,
        total_farmacias: 0,
      });
    });

    app.get('/api/acoes/:id', comAuth, async (request) => {
      const { acao, farmacias } = await this.service.detalhar(this.id(request.params));
      return {
        ...this.cabecalho(acao),
        criado_por_nome: acao.criado_por_nome ?? null,
        criado_em:       acao.criado_em,
        atualizado_em:   acao.atualizado_em,
        farmacias: farmacias.map((p) => ({
          participacao_id: int(p.participacao_id),
          farmacia_id:     int(p.farmacia_id),
          farmacia_nome:   p.farmacia_nome,
          cidade:          p.cidade      ?? null,
          responsavel:     p.responsavel ?? null,
          telefone:        p.telefone    ?? null,
          gestor_id:       idOuNull(p.gestor_id),
          gestor_nome:     p.gestor_nome ?? null,
          nivel_alerta:    p.nivel_alerta,
          observacoes:     p.observacoes ?? null,
          adicionado_em:   p.adicionado_em,
        })),
        total_farmacias: farmacias.length,
      };
    });

    app.put('/api/acoes/:id', soAdmin, async (request) => {
      const a = await this.service.atualizar(this.id(request.params), request.body as DadosAcao);
      return { ...this.daTabela(a), atualizado_em: a.atualizadoEm };
    });

    app.delete('/api/acoes/:id', soAdmin, async (request) => {
      const id = this.id(request.params);
      await this.service.cancelar(id);
      return { mensagem: 'Ação cancelada.', id };
    });

    /** Body: { farmacia_ids: number[], observacoes?: string } */
    app.post('/api/acoes/:id/farmacias', soAdmin, async (request, reply) => {
      const b = (request.body ?? {}) as { farmacia_ids?: unknown; observacoes?: string };
      const { adicionadas, total } = await this.service.adicionarFarmacias(
        this.id(request.params), b.farmacia_ids, b.observacoes ?? null, request.user,
      );
      return reply.code(201).send({
        mensagem:        `${adicionadas} farmácia(s) adicionada(s) à ação.`,
        adicionadas,
        total_farmacias: total,
      });
    });

    app.delete('/api/acoes/:id/farmacias/:farmaciaId', soAdmin, async (request) => {
      const p = request.params as Params;
      await this.service.removerFarmacia(int(p.id), int(p.farmaciaId));
      return { mensagem: 'Farmácia removida da ação.' };
    });

    /** Body: { observacoes: string } */
    app.patch('/api/acoes/:id/farmacias/:farmaciaId', soAdmin, async (request) => {
      const p = request.params as Params;
      const b = request.body as { observacoes?: string } | undefined;
      await this.service.anotar(int(p.id), int(p.farmaciaId), b?.observacoes ?? null);
      return { mensagem: 'Observações atualizadas.' };
    });

    /** ?mes=YYYY-MM */
    app.get('/api/farmacias/:id/acoes', comAuth, async (request) => {
      const linhas = await this.service.daFarmacia(
        request.user, this.id(request.params), (request.query as { mes?: string }).mes,
      );
      return linhas.map((r) => ({
        id:             int(r.id),
        nome:           r.nome,
        tipo:           r.tipo,
        descricao:      r.descricao ?? null,
        mes_referencia: r.mes_referencia,
        status:         r.status,
        cor:            r.cor ?? null,
        criado_em:      r.criado_em,
        observacoes:    r.observacoes ?? null,
        adicionado_em:  r.adicionado_em,
      }));
    });
  }

  /** Campos comuns de uma ação vinda de SQL cru. */
  private cabecalho(r: Linha) {
    return {
      id:             int(r.id),
      nome:           r.nome,
      tipo:           r.tipo,
      descricao:      r.descricao ?? null,
      mes_referencia: r.mes_referencia,
      status:         r.status,
      cor:            r.cor ?? null,
      criado_por_id:  idOuNull(r.criado_por_id),
    };
  }

  /** Campos comuns de uma ação vinda do drizzle. */
  private daTabela(a: Acao) {
    return {
      id:             a.id,
      nome:           a.nome,
      tipo:           a.tipo,
      descricao:      a.descricao ?? null,
      mes_referencia: a.mesReferencia,
      status:         a.status,
      cor:            a.cor ?? null,
    };
  }

  private id(params: unknown): number {
    return int((params as Params).id);
  }
}
