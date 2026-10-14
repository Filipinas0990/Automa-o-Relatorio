import type { FastifyInstance } from 'fastify';
import { Controller } from '../compartilhado/Controller';
import { ErroAplicacao, RequisicaoInvalida, NaoAutorizado } from '../compartilhado/erros';
import { logger } from '../logger';
import type { Autenticador } from '../auth/Autenticador';
import type { DisparoService, CriarDisparoBody } from './DisparoService';
import type { GrupoSelecionado, MidiaDisparo, ResultadoGrupo } from './types';

/**
 * Disparo de ofertas nos grupos de WhatsApp (rotas /api/disparos).
 *
 * Multi-tenant por GESTOR: cada gestor opera as farmácias dele. Autenticação
 * é só `autenticar` em quase tudo — nenhuma rota de disparo é admin-only,
 * exceto o callback do motor de campanhas, que usa um segredo interno
 * próprio em vez do JWT dos gestores.
 */
export class DisparoController extends Controller {
  constructor(
    private readonly service: DisparoService,
    private readonly auth: Autenticador,
  ) {
    super();
  }

  protected rotas(app: FastifyInstance): void {
    const { autenticar } = this.auth;
    const comAuth = { preHandler: autenticar };

    // ── Conexão de WhatsApp do gestor ──────────────────────────────────────

    /**
     * POST /api/disparos/whatsapp/conectar
     * Cria/reconecta a instância Evolution do gestor logado e devolve o QR code.
     */
    app.post('/api/disparos/whatsapp/conectar', comAuth, async (req) => {
      return this.service.conectarGestor(req.user.id);
    });

    /**
     * GET /api/disparos/whatsapp/status
     * Status ao vivo + QR code (o wizard faz polling enquanto está 'connecting').
     */
    app.get('/api/disparos/whatsapp/status', comAuth, async (req) => {
      return this.service.statusGestor(req.user.id);
    });

    /** DELETE /api/disparos/whatsapp — desconecta (logout). */
    app.delete('/api/disparos/whatsapp', comAuth, async (req, reply) => {
      await this.service.desconectarGestor(req.user.id);
      return reply.code(204).send();
    });

    // ── Grupos ───────────────────────────────────────────────────────────────

    /**
     * GET /api/disparos/conexoes
     * Conexões que o gestor pode usar no disparo: a dele + as globais (opção b).
     */
    app.get('/api/disparos/conexoes', comAuth, async (req) => {
      return this.service.listarConexoes(req.user.id);
    });

    /**
     * GET /api/disparos/grupos?instance=<instanceName>&refresh=1
     * Grupos da conexão escolhida (ou a do gestor, se `instance` não vier).
     * Vem do cache (migration 0020); `refresh=1` força ir na Evolution e esperar.
     */
    app.get<{ Querystring: { instance?: string; refresh?: string } }>(
      '/api/disparos/grupos',
      comAuth,
      async (req, reply) => {
        try {
          const opts = { forcar: req.query.refresh === '1' || req.query.refresh === 'true' };
          const grupos = await this.service.gruposDaConexaoOuDoGestor(req.user.id, req.query.instance, opts);
          return reply.send(grupos);
        } catch (err) {
          if (err instanceof ErroAplicacao) throw err;
          logger.error({ err, gestorId: req.user.id }, 'Erro ao listar grupos');
          const msg = err instanceof Error ? err.message : 'Erro ao listar grupos';
          return reply.code(502).send({ detail: msg });
        }
      },
    );

    /**
     * GET /api/disparos/donos-grupos?jids=a@g.us,b@g.us
     * Para cada grupo, as farmácias com campanha AINDA RODANDO nele.
     *
     * O modal de agendamento usa isto para avisar quando o grupo escolhido é de
     * outro cliente — foi assim que a oferta da Farma Fátima caiu no grupo da
     * Mais Saúde. Escopo por gestor: o histórico de um gestor não vaza para outro.
     */
    app.get<{ Querystring: { jids?: string } }>(
      '/api/disparos/donos-grupos',
      comAuth,
      async (req, reply) => {
        const jids = (req.query.jids ?? '')
          .split(',')
          .map((j) => j.trim())
          .filter((j) => j.endsWith('@g.us'))
          .slice(0, 200);   // teto: a lista vem da tela, não do banco

        if (jids.length === 0) return reply.send([]);

        const donos = await this.service.donosDeGrupos(req.user.id, jids);

        return reply.send(donos.map((d) => ({
          jid:         d.jid,
          farmacia_id: d.farmaciaId,
          farmacia:    d.nomeFachada?.trim() || d.nome,
        })));
      },
    );

    // ── Horários pré-definidos (migration 0022) ────────────────────────────

    /** GET /api/disparos/horarios — lista do gestor (semeia os padrões na 1ª vez). */
    app.get('/api/disparos/horarios', comAuth, async (req, reply) => {
      const horarios = await this.service.listarHorarios(req.user.id);
      return reply.send(horarios.map((h) => ({ id: h.id, horario: h.horario, rotulo: h.rotulo })));
    });

    /** POST /api/disparos/horarios — adiciona um horário à lista. */
    app.post<{ Body: { horario?: string; rotulo?: string | null } }>(
      '/api/disparos/horarios',
      comAuth,
      async (req, reply) => {
        const horarios = await this.service.adicionarHorario(req.user.id, req.body?.horario, req.body?.rotulo);
        return reply.code(201).send(horarios.map((h) => ({ id: h.id, horario: h.horario, rotulo: h.rotulo })));
      },
    );

    /** DELETE /api/disparos/horarios/:id — tira da lista. */
    app.delete<{ Params: { id: string } }>(
      '/api/disparos/horarios/:id',
      comAuth,
      async (req, reply) => {
        await this.service.removerHorario(req.user.id, parseInt(req.params.id, 10));
        return reply.code(204).send();
      },
    );

    // ── Disparos ─────────────────────────────────────────────────────────────

    /**
     * POST /api/disparos
     * Cria o disparo. quando='agora' envia na hora; 'agendado' grava para o scheduler.
     */
    app.post<{ Body: CriarDisparoBody }>(
      '/api/disparos',
      // bodyLimit alto: o disparo carrega os criativos (imagens) em base64,
      // e podem ser vários — o padrão de 1 MB do Fastify estoura fácil.
      { preHandler: [autenticar], bodyLimit: 80 * 1024 * 1024 },
      async (req, reply) => {
        const r = await this.service.criar(req.user.id, req.body);

        if (r.tipo === 'enfileirado') {
          // Enfileirado no motor de campanhas — o resultado por grupo chega
          // depois via callback; aqui só confirmamos o aceite.
          return reply.code(202).send({ id: r.id, status: 'enviando', total_grupos: r.totalGrupos });
        }
        if (r.tipo === 'enviado') {
          return reply.code(201).send({ id: r.id, status: 'enviado', enviados: r.enviados, falhas: r.falhas });
        }
        return reply.code(201).send({
          id: r.id, status: 'agendado', agendado_para: r.agendadoPara, repetir: r.repetir,
        });
      },
    );

    /**
     * POST /api/disparos/callback
     * Recebe do motor de campanhas o resultado de um disparo (status por grupo) e
     * finaliza: grava os logs e recalcula status/próximo envio.
     *
     * Autenticação é o segredo interno compartilhado (header x-internal-key) — NÃO
     * usa o JWT dos gestores, pois quem chama é o campanhas, não um usuário.
     */
    app.post<{ Body: { disparoId: number; resultados: ResultadoGrupo[] } }>(
      '/api/disparos/callback',
      async (req, reply) => {
        const key = req.headers['x-internal-key'];
        if (typeof key !== 'string' || key !== (process.env.INTERNAL_API_KEY || '')) {
          throw new NaoAutorizado('não autorizado');
        }

        const { disparoId, resultados } = req.body ?? {};
        if (!disparoId || !Array.isArray(resultados)) {
          throw new RequisicaoInvalida('disparoId e resultados são obrigatórios');
        }

        try {
          const r = await this.service.finalizarDisparo(Number(disparoId), resultados);
          return reply.send({ ok: true, ...r });
        } catch (err) {
          logger.error({ err, disparoId }, 'Erro ao finalizar disparo (callback do campanhas)');
          const msg = err instanceof Error ? err.message : 'Erro ao finalizar disparo';
          return reply.code(500).send({ detail: msg });
        }
      },
    );

    /**
     * GET /api/disparos/ultimos-produtos/:farmaciaId
     * Produtos anunciados na última campanha DESTE cliente — o chip "Recentes"
     * do passo 3. Devolve lista vazia quando não há disparo anterior com o dado.
     */
    app.get<{ Params: { farmaciaId: string } }>(
      '/api/disparos/ultimos-produtos/:farmaciaId',
      comAuth,
      async (req, reply) => {
        const farmaciaId = parseInt(req.params.farmaciaId, 10);
        if (Number.isNaN(farmaciaId)) throw new RequisicaoInvalida('farmaciaId inválido.');

        const ultimo = await this.service.ultimosProdutos(req.user.id, farmaciaId);
        if (!ultimo) return reply.send({ produtos: [], disparado_em: null });

        let produtos: { id: number; nome: string }[] = [];
        // JSON quebrado não pode derrubar o passo 3 inteiro por causa de um chip.
        try { produtos = JSON.parse(ultimo.produtosJson); } catch { /* ignore */ }

        return reply.send({
          produtos: Array.isArray(produtos) ? produtos : [],
          disparado_em: ultimo.criadoEm,
        });
      },
    );

    /** GET /api/disparos — histórico dos disparos do gestor. */
    app.get('/api/disparos', comAuth, async (req, reply) => {
      const disparos = await this.service.listar(req.user.id);

      return reply.send(
        disparos.map((d) => {
          let totalGrupos = 0;
          try { totalGrupos = (JSON.parse(d.gruposJson) as unknown[]).length; } catch { /* ignore */ }
          let totalMidias = 0;
          try { totalMidias = d.midiasJson ? (JSON.parse(d.midiasJson) as unknown[]).length : 0; } catch { /* ignore */ }
          return {
            id:            d.id,
            titulo:        d.titulo,
            mensagem:      d.mensagem,
            total_midias:  totalMidias,
            farmacia_id:   d.farmaciaId,
            total_grupos:  totalGrupos,
            quando:        d.quando,
            repetir:       d.repetir,
            status:        d.status,
            agendado_para: d.agendadoPara,
            proximo_envio: d.proximoEnvio,
            repetir_ate:   d.repetirAte,
            repetir_produtos: d.repetirProdutos,
            ultimo_envio:  d.ultimoEnvio,
            criado_em:     d.criadoEm,
          };
        }),
      );
    });

    /**
     * GET /api/disparos/:id — detalhe de UM disparo, para o gestor acompanhar.
     *
     * Devolve os RÓTULOS dos criativos, nunca o base64: `midias_json` guarda as
     * imagens inteiras, e um disparo com 43 produtos pesa dezenas de MB — isso
     * não pode atravessar a rede só para montar uma tela de acompanhamento.
     *
     * `cursor_midia` vem junto porque é ele que responde "quantos produtos ainda
     * faltam": tudo antes do cursor já foi postado nesta volta da lista.
     */
    app.get<{ Params: { id: string } }>(
      '/api/disparos/:id',
      comAuth,
      async (req, reply) => {
        const d = await this.service.detalhar(req.user.id, parseInt(req.params.id, 10));

        const jsonOu = <T>(texto: string | null, padrao: T): T => {
          if (!texto) return padrao;
          try { return JSON.parse(texto) as T; } catch { return padrao; }
        };

        const midias = jsonOu<Array<{ rotulo?: string | null }>>(d.midiasJson, []);

        return reply.send({
          id:            d.id,
          titulo:        d.titulo,
          mensagem:      d.mensagem,
          farmacia_id:   d.farmaciaId,
          quando:        d.quando,
          status:        d.status,
          repetir:       d.repetir,
          repetir_ate:   d.repetirAte,
          repetir_produtos: d.repetirProdutos,
          agendado_para: d.agendadoPara,
          proximo_envio: d.proximoEnvio,
          ultimo_envio:  d.ultimoEnvio,
          criado_em:     d.criadoEm,
          horarios:      jsonOu<string[]>(d.horariosJson, []),
          grupos:        jsonOu<Array<{ jid: string; nome?: string }>>(d.gruposJson, []),
          // Índice do PRÓXIMO produto a sair; o de antes já foi.
          cursor_midia:  d.cursorMidia ?? 0,
          // Só o rótulo ("Produto — R$ 9,99"). Arte pronta não tem rótulo.
          produtos:      midias.map((m) => m.rotulo ?? null),
        });
      },
    );

    /** GET /api/disparos/:id/logs — resultado por grupo. */
    app.get<{ Params: { id: string } }>(
      '/api/disparos/:id/logs',
      comAuth,
      async (req, reply) => {
        const logs = await this.service.logs(req.user.id, parseInt(req.params.id, 10));
        return reply.send(logs);
      },
    );

    /** DELETE /api/disparos/:id — cancela um agendamento. */
    app.delete<{ Params: { id: string } }>(
      '/api/disparos/:id',
      comAuth,
      async (req, reply) => {
        await this.service.cancelar(req.user.id, parseInt(req.params.id, 10));
        return reply.code(204).send();
      },
    );
  }
}

// Reexportado para quem (ex.: o scheduler) só precisa dos tipos de payload do disparo.
export type { GrupoSelecionado, MidiaDisparo };
