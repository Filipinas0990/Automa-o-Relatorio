import type { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from 'fastify';
import { disparosRepository } from './repository';
import { disparosService, motivoEvolutionIndisponivel } from './service';
import type { GrupoSelecionado, MidiaDisparo, ResultadoGrupo } from './service';
import { ofertasRepository } from '../ofertas/repository';
import { logger } from '../logger';

type Middleware = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

interface DisparosRouteOptions extends FastifyPluginOptions {
  autenticar:  Middleware;
  apenasAdmin: Middleware;
}

interface CriarDisparoBody {
  titulo:          string;
  mensagem:        string;
  midias?:         MidiaDisparo[];
  grupos:          GrupoSelecionado[];
  quando:          'agora' | 'agendado';
  agendado_para?:  string | null;   // ISO
  repetir?:        'nunca' | 'diario' | 'semanal' | 'mensal';
  timezone?:       string;
  farmacia_id?:    number | null;
  solicitacao_id?: number | null;
  instance?:       string | null;   // conexão Evolution escolhida no passo 1
}

/**
 * Disparo de ofertas nos grupos de WhatsApp.
 *
 * Multi-tenant por GESTOR: cada gestor tem uma conexão de WhatsApp e enxerga
 * somente os grupos dela. O escopo é implícito — tudo deriva de req.user.id,
 * então não há como um gestor alcançar os grupos ou os disparos de outro.
 */
export async function disparosRoutes(
  app:  FastifyInstance,
  opts: DisparosRouteOptions,
): Promise<void> {
  const { autenticar } = opts;

  // ── Conexão de WhatsApp do gestor ──────────────────────────────────────────

  /**
   * POST /api/disparos/whatsapp/conectar
   * Cria/reconecta a instância Evolution do gestor logado e devolve o QR code.
   */
  app.post('/api/disparos/whatsapp/conectar', { preHandler: [autenticar] }, async (req, reply) => {
    const motivo = motivoEvolutionIndisponivel();
    if (motivo) return reply.code(503).send({ detail: motivo });

    try {
      const resultado = await disparosService.conectarGestor(req.user.id);
      return reply.send(resultado);
    } catch (err) {
      logger.error({ err, gestorId: req.user.id }, 'Erro ao conectar WhatsApp do gestor');
      // Devolve a causa real (DNS, recusa de conexão, timeout) — o genérico
      // manda o gestor procurar defeito no lugar errado.
      const causa = err instanceof Error ? err.message : String(err);
      return reply.code(502).send({
        detail: `Não foi possível falar com a Evolution API (${process.env.EVOLUTION_API_URL}): ${causa}`,
      });
    }
  });

  /**
   * GET /api/disparos/whatsapp/status
   * Status ao vivo + QR code (o wizard faz polling enquanto está 'connecting').
   */
  app.get('/api/disparos/whatsapp/status', { preHandler: [autenticar] }, async (req, reply) => {
    const status = await disparosService.statusGestor(req.user.id);
    return reply.send(status);
  });

  /** DELETE /api/disparos/whatsapp — desconecta (logout). */
  app.delete('/api/disparos/whatsapp', { preHandler: [autenticar] }, async (req, reply) => {
    await disparosService.desconectarGestor(req.user.id);
    return reply.code(204).send();
  });

  // ── Grupos ─────────────────────────────────────────────────────────────────

  /**
   * GET /api/disparos/grupos
   * Grupos da conexão do gestor logado — os grupos de oferta dos clientes dele.
   */
  /**
   * GET /api/disparos/conexoes
   * Conexões que o gestor pode usar no disparo: a dele + as globais (opção b).
   */
  app.get('/api/disparos/conexoes', { preHandler: [autenticar] }, async (req, reply) => {
    const conexoes = await disparosService.listarConexoes(req.user.id);
    return reply.send(conexoes);
  });

  /**
   * GET /api/disparos/grupos?instance=<instanceName>&refresh=1
   * Grupos da conexão escolhida (ou a do gestor, se `instance` não vier).
   * Vem do cache (migration 0020); `refresh=1` força ir na Evolution e esperar.
   */
  app.get<{ Querystring: { instance?: string; refresh?: string } }>(
    '/api/disparos/grupos',
    { preHandler: [autenticar] },
    async (req, reply) => {
      try {
        const instance = req.query.instance;
        const opts = { forcar: req.query.refresh === '1' || req.query.refresh === 'true' };
        let grupos;
        if (instance) {
          const permitidas = await disparosService.instanciasPermitidas(req.user.id);
          if (!permitidas.has(instance)) {
            return reply.code(403).send({ detail: 'Esta conexão não está disponível para você.' });
          }
          grupos = await disparosService.listarGruposDeInstancia(instance, opts);
        } else {
          grupos = await disparosService.listarGrupos(req.user.id, opts);
        }
        return reply.send(grupos);
      } catch (err) {
        logger.error({ err, gestorId: req.user.id }, 'Erro ao listar grupos');
        const msg = err instanceof Error ? err.message : 'Erro ao listar grupos';
        return reply.code(502).send({ detail: msg });
      }
    },
  );

  // ── Disparos ───────────────────────────────────────────────────────────────

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
      const b = req.body;
      const midias = Array.isArray(b.midias) ? b.midias.filter((m) => m?.b64) : [];

      if (!b.mensagem?.trim() && midias.length === 0) {
        return reply.code(400).send({ detail: 'Informe a mensagem ou ao menos um criativo.' });
      }
      if (!Array.isArray(b.grupos) || b.grupos.length === 0) {
        return reply.code(400).send({ detail: 'Selecione ao menos um grupo.' });
      }

      const quando  = b.quando === 'agendado' ? 'agendado' : 'agora';
      const repetir = b.repetir ?? 'nunca';

      let agendadoPara: Date | null = null;
      if (quando === 'agendado') {
        if (!b.agendado_para) {
          return reply.code(400).send({ detail: 'Informe a data e hora do agendamento.' });
        }
        agendadoPara = new Date(b.agendado_para);
        if (Number.isNaN(agendadoPara.getTime())) {
          return reply.code(400).send({ detail: 'Data de agendamento inválida.' });
        }
      }

      // Conexão escolhida no passo 1 (opção b: a do gestor ou uma global).
      let instanceName: string | null = null;
      if (b.instance) {
        const permitidas = await disparosService.instanciasPermitidas(req.user.id);
        if (!permitidas.has(b.instance)) {
          return reply.code(403).send({ detail: 'Esta conexão não está disponível para você.' });
        }
        instanceName = b.instance;
      } else {
        // Sem escolha explícita: usa a conexão do gestor, que precisa estar conectada.
        const status = await disparosService.statusGestor(req.user.id);
        if (!status.conectado) {
          return reply.code(409).send({
            detail: 'Selecione uma conexão conectada antes de disparar.',
          });
        }
      }

      // A solicitação precisa ser do próprio gestor — senão dava para marcar
      // como atendida o pedido de um cliente de outro gestor.
      let solicitacaoId: number | null = null;
      if (b.solicitacao_id) {
        const s = await ofertasRepository.getSolicitacao(Number(b.solicitacao_id));
        if (s && s.gestorId === req.user.id) solicitacaoId = s.id;
      }

      const disparo = await disparosRepository.criarDisparo({
        gestorId:      req.user.id,
        instanceName,
        titulo:        b.titulo?.trim() || 'Ofertas',
        mensagem:      b.mensagem ?? '',
        midiasJson:    midias.length ? JSON.stringify(midias) : null,
        farmaciaId:    b.farmacia_id ? Number(b.farmacia_id) : null,
        solicitacaoId,
        gruposJson:   JSON.stringify(b.grupos),
        quando,
        agendadoPara,
        repetir,
        timezone:     b.timezone ?? 'America/Sao_Paulo',
        status:       quando === 'agora' ? 'enviando' : 'agendado',
        proximoEnvio: quando === 'agora' ? null : agendadoPara,
      });

      if (quando === 'agora') {
        try {
          const resultado = await disparosService.executarDisparo(disparo.id);
          if (solicitacaoId) {
            await ofertasRepository.atualizarStatus(solicitacaoId, 'atendida');
          }
          if (resultado.modo === 'campanhas') {
            // Enfileirado no motor de campanhas — o resultado por grupo chega
            // depois via callback; aqui só confirmamos o aceite.
            return reply.code(202).send({
              id: disparo.id, status: 'enviando', total_grupos: resultado.grupos,
            });
          }
          return reply.code(201).send({
            id:       disparo.id,
            status:   'enviado',
            enviados: resultado.enviados,
            falhas:   resultado.falhas,
          });
        } catch (err) {
          logger.error({ err, disparoId: disparo.id }, 'Erro ao executar disparo imediato');
          await disparosRepository.atualizarDisparo(disparo.id, { status: 'erro' });
          const msg = err instanceof Error ? err.message : 'Erro ao disparar';
          return reply.code(502).send({ detail: msg });
        }
      }

      return reply.code(201).send({
        id: disparo.id, status: 'agendado', agendado_para: agendadoPara, repetir,
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
        return reply.code(401).send({ detail: 'não autorizado' });
      }

      const { disparoId, resultados } = req.body ?? {};
      if (!disparoId || !Array.isArray(resultados)) {
        return reply.code(400).send({ detail: 'disparoId e resultados são obrigatórios' });
      }

      try {
        const r = await disparosService.finalizarDisparo(Number(disparoId), resultados);
        return reply.send({ ok: true, ...r });
      } catch (err) {
        logger.error({ err, disparoId }, 'Erro ao finalizar disparo (callback do campanhas)');
        const msg = err instanceof Error ? err.message : 'Erro ao finalizar disparo';
        return reply.code(500).send({ detail: msg });
      }
    },
  );

  /** GET /api/disparos — histórico dos disparos do gestor. */
  app.get('/api/disparos', { preHandler: [autenticar] }, async (req, reply) => {
    const disparos = await disparosRepository.listarDisparos(req.user.id);

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
          ultimo_envio:  d.ultimoEnvio,
          criado_em:     d.criadoEm,
        };
      }),
    );
  });

  /** GET /api/disparos/:id/logs — resultado por grupo. */
  app.get<{ Params: { id: string } }>(
    '/api/disparos/:id/logs',
    { preHandler: [autenticar] },
    async (req, reply) => {
      const disparo = await disparosRepository.getDisparo(parseInt(req.params.id, 10));
      if (!disparo) return reply.code(404).send({ detail: 'Disparo não encontrado' });
      if (disparo.gestorId !== req.user.id) {
        return reply.code(403).send({ detail: 'Este disparo não pertence a você' });
      }

      return reply.send(await disparosRepository.logsDoDisparo(disparo.id));
    },
  );

  /** DELETE /api/disparos/:id — cancela um agendamento. */
  app.delete<{ Params: { id: string } }>(
    '/api/disparos/:id',
    { preHandler: [autenticar] },
    async (req, reply) => {
      const disparo = await disparosRepository.getDisparo(parseInt(req.params.id, 10));
      if (!disparo) return reply.code(404).send({ detail: 'Disparo não encontrado' });
      if (disparo.gestorId !== req.user.id) {
        return reply.code(403).send({ detail: 'Este disparo não pertence a você' });
      }

      await disparosRepository.atualizarDisparo(disparo.id, {
        status: 'cancelado', proximoEnvio: null,
      });
      return reply.code(204).send();
    },
  );
}
