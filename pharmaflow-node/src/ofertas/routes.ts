import type { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from 'fastify';
import { ofertasRepository } from './repository';
import { ofertasService, limparPreco } from './service';
import { disparosRepository } from '../disparos/repository';
import { listarProdutos, getImagem } from '../catalogo/repository';
import { logger } from '../logger';
import { nomeVisivel } from '../database/schema';

type Middleware = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

interface OfertasRouteOptions extends FastifyPluginOptions {
  autenticar:  Middleware;
  apenasAdmin: Middleware;
}

/**
 * O dono manda `[{ id, preco, preco_de }]`. Ainda aceitamos `number[]` (o
 * formato antigo) porque um celular com a página em cache continua postando
 * assim — e `preco_de` também falta nos envios anteriores ao de/por.
 */
type ProdutoEnviado = number | { id: number; preco?: string | null; preco_de?: string | null };

interface EnviarOfertaBody {
  farmacia_id:      number;
  produtos:         ProdutoEnviado[];
  /** Obrigatório: o gestor precisa saber com quem falar sobre a lista. */
  enviado_por:      string;
}

/**
 * Produto dentro do JSON da solicitação. Nome e preços viajam junto do id
 * porque o catálogo pode mudar depois do envio.
 */
interface ProdutoSolicitado {
  id:        number;
  nome:      string;
  preco?:    string | null;
  /** Preço antigo (riscado na arte) quando o dono ligou o "de/por". */
  preco_de?: string | null;
}


/**
 * Ofertas enviadas pelo dono da farmácia.
 *
 * As rotas sob /api/publico/ NÃO exigem JWT — o token do link é a credencial
 * (mesmo princípio do webhook da Evolution). Tudo que elas devolvem é derivado
 * do token, então um link só alcança as farmácias do gestor que o gerou.
 */
export async function ofertasRoutes(
  app:  FastifyInstance,
  opts: OfertasRouteOptions,
): Promise<void> {
  const { autenticar } = opts;

  // ── Públicas (o dono da farmácia, sem login) ───────────────────────────────

  /**
   * Resolve o token e, quando o link é de um cliente, a farmácia dele.
   * A farmácia é revalidada a cada acesso: se ela for desativada ou passar
   * para outro gestor, o link tem de parar de funcionar.
   */
  async function abrirLink(token: string) {
    const link = await ofertasRepository.porToken(token);
    if (!link) return null;

    if (link.farmaciaId === null) return { ...link, farmacia: null };

    const farmacia = await ofertasRepository.getFarmaciaAtiva(link.farmaciaId);
    if (!farmacia) return null;
    if (!link.gestor.isAdmin && farmacia.gestorId !== link.gestor.id) return null;

    return { ...link, farmacia };
  }

  /**
   * GET /api/publico/ofertas/:token
   * Abre o link: quem é o gestor, a farmácia do cliente e o catálogo.
   * Nos links legados (sem farmácia) ainda vem a lista para o dono escolher.
   */
  app.get<{ Params: { token: string } }>(
    '/api/publico/ofertas/:token',
    async (req, reply) => {
      const link = await abrirLink(req.params.token);
      // 404 genérico: não revela se o token existe mas está inativo
      if (!link) return reply.code(404).send({ detail: 'Link inválido ou expirado.' });

      const [lista, produtos] = await Promise.all([
        // Link de cliente não expõe as outras farmácias da carteira.
        link.farmacia
          ? Promise.resolve([])
          : ofertasRepository.farmaciasDoGestor(link.gestor.id, link.gestor.isAdmin),
        listarProdutos(),
      ]);

      return reply.send({
        gestor:    { nome: link.gestor.nome },
        farmacia:  link.farmacia
          ? { id: link.farmacia.id, nome: nomeVisivel(link.farmacia), cidade: link.farmacia.cidade }
          : null,
        farmacias: lista.map((f) => ({ id: f.id, nome: nomeVisivel(f), cidade: f.cidade })),
        // só produtos ativos são oferecidos ao dono da farmácia
        produtos:  produtos
          .filter((p) => p.ativo)
          .map((p) => ({ id: p.id, nome: p.nome, categoria: p.categoria })),
      });
    },
  );

  /**
   * GET /api/publico/ofertas/:token/produto/:id/imagem
   * Foto do produto — o dono precisa ver o que está escolhendo.
   */
  app.get<{ Params: { token: string; id: string } }>(
    '/api/publico/ofertas/:token/produto/:id/imagem',
    async (req, reply) => {
      const link = await abrirLink(req.params.token);
      if (!link) return reply.code(404).send({ detail: 'Link inválido ou expirado.' });

      const img = await getImagem(parseInt(req.params.id, 10));
      if (!img?.imagemB64) return reply.code(404).send({ detail: 'Sem imagem' });

      return reply
        .header('Content-Type', img.mime || 'image/png')
        .header('Cache-Control', 'public, max-age=86400')
        .send(Buffer.from(img.imagemB64, 'base64'));
    },
  );

  /**
   * POST /api/publico/ofertas/:token
   * O dono envia a seleção. No link de cliente a farmácia vem do próprio token
   * (o corpo não decide nada); no legado, ela ainda precisa ser do gestor —
   * senão um link permitiria enviar em nome de cliente de outro gestor.
   */
  app.post<{ Params: { token: string }; Body: EnviarOfertaBody }>(
    '/api/publico/ofertas/:token',
    async (req, reply) => {
      const link = await abrirLink(req.params.token);
      if (!link) return reply.code(404).send({ detail: 'Link inválido ou expirado.' });

      const gestor = link.gestor;
      const b = req.body;

      let farmaciaId: number;
      if (link.farmacia) {
        farmaciaId = link.farmacia.id;
      } else {
        farmaciaId = Number(b?.farmacia_id);
        if (!Number.isFinite(farmaciaId)) {
          return reply.code(400).send({ detail: 'Escolha a sua farmácia.' });
        }

        const doGestor = await ofertasRepository.farmaciasDoGestor(gestor.id, gestor.isAdmin);
        if (!doGestor.some((f) => f.id === farmaciaId)) {
          return reply.code(403).send({ detail: 'Esta farmácia não está disponível neste link.' });
        }
      }

      const escolhidos = (Array.isArray(b.produtos) ? b.produtos : [])
        .map((p) => (typeof p === 'object' && p !== null
          ? { id: Number(p.id), preco: limparPreco(p.preco), precoDe: limparPreco(p.preco_de) }
          : { id: Number(p), preco: null, precoDe: null }))
        .filter((p) => Number.isFinite(p.id))
        // "de" sem "por" não vira arte nenhuma: o riscado só existe em relação
        // ao preço da oferta. Cai fora aqui para não chegar quebrado no gestor.
        .map((p) => (p.preco ? p : { ...p, precoDe: null }));

      if (escolhidos.length === 0) {
        return reply.code(400).send({ detail: 'Escolha ao menos um produto.' });
      }

      // Nome de quem enviou é obrigatório (migration 0027). O corte em 120
      // acompanha o tamanho da coluna.
      const enviadoPor = (b.enviado_por ?? '').trim().slice(0, 120);
      if (enviadoPor.length < 2) {
        return reply.code(400).send({ detail: 'Informe o seu nome para enviar a lista.' });
      }

      // Guarda nome e preço junto do id: o catálogo pode mudar depois do envio
      const catalogo = await listarProdutos();
      const porId = new Map(catalogo.map((p) => [p.id, p.nome]));
      const produtos: ProdutoSolicitado[] = escolhidos
        .filter((p) => porId.has(p.id))
        .map((p) => ({
          id:       p.id,
          nome:     porId.get(p.id) as string,
          preco:    p.preco,
          preco_de: p.precoDe,
        }));

      const solicitacao = await ofertasRepository.criarSolicitacao({
        gestorId:       gestor.id,
        farmaciaId,
        produtosJson:   JSON.stringify(produtos),
        enviadoPor,
      });

      logger.info(
        { solicitacaoId: solicitacao.id, gestorId: gestor.id, farmaciaId, total: produtos.length },
        'Nova solicitação de oferta recebida pelo link público',
      );

      return reply.code(201).send({ ok: true, id: solicitacao.id });
    },
  );

  // ── Do gestor (JWT) ────────────────────────────────────────────────────────

  /**
   * POST /api/ofertas/link/:farmaciaId/regenerar
   * Troca o token daquele cliente — usado quando o link vaza ou o dono some.
   */
  app.post<{ Params: { farmaciaId: string } }>(
    '/api/ofertas/link/:farmaciaId/regenerar',
    { preHandler: [autenticar] },
    async (req, reply) => {
      const farmaciaId = parseInt(req.params.farmaciaId, 10);
      const farmacia = await ofertasRepository.getFarmaciaAtiva(farmaciaId);
      if (!farmacia) return reply.code(404).send({ detail: 'Farmácia não encontrada' });
      if (!req.user.isAdmin && farmacia.gestorId !== req.user.id) {
        return reply.code(403).send({ detail: 'Esta farmácia não é da sua carteira' });
      }

      const link = await ofertasService.regenerarLink(req.user.id, farmaciaId);
      return reply.send(link);
    },
  );

  /** GET /api/ofertas/solicitacoes — o que os clientes enviaram. */
  app.get('/api/ofertas/solicitacoes', { preHandler: [autenticar] }, async (req, reply) => {
    const lista = await ofertasRepository.listarSolicitacoes(req.user.id);

    return reply.send(
      lista.map((s) => {
        let produtos: ProdutoSolicitado[] = [];
        try { produtos = JSON.parse(s.produtosJson); } catch { /* ignore */ }
        return {
          id:              s.id,
          farmacia_id:     s.farmaciaId,
          farmacia:        s.farmacia,
          produtos,
          enviado_por:     s.enviadoPor,
          status:          s.status,
          criado_em:       s.criadoEm,
          atendida_em:     s.atendidaEm,
        };
      }),
    );
  });

  /**
   * GET /api/ofertas/carteira
   * Todas as farmácias do gestor com o estado de resposta de cada uma.
   * Alimenta o painel de acompanhamento (passo 2 do disparo).
   */
  app.get('/api/ofertas/carteira', { preHandler: [autenticar] }, async (req, reply) => {
    // Admin vê todas — senão o pedido que chegou pelo link dele ficaria órfão,
    // sem a farmácia correspondente na carteira.
    const carteira = await ofertasRepository.carteiraDoGestor(req.user.id, req.user.isAdmin);

    // Cada cliente tem o SEU link (migration 0021) — vem junto para o gestor
    // copiar direto na linha, sem um request por farmácia.
    const [links, campanhas] = await Promise.all([
      ofertasService.linksDaCarteira(
        req.user.id,
        carteira.map(({ farmacia }) => farmacia.id),
      ),
      // A última campanha de cada cliente: é o que a linha mostra no lugar do
      // verde depois que o pedido foi montado.
      disparosRepository.ultimaCampanhaPorFarmacia(req.user.id),
    ]);

    return reply.send(
      carteira.map(({ farmacia, pendente, ultima, ultimoEnvioEm }) => {
        const listaDe = (json: string | null | undefined): ProdutoSolicitado[] => {
          if (!json) return [];
          try { return JSON.parse(json); } catch { return []; }
        };
        const produtos = listaDe(pendente?.produtosJson);
        const campanha = campanhas.get(farmacia.id) ?? null;

        return {
          farmacia_id:  farmacia.id,
          farmacia:     farmacia.nome,
          // O que pode aparecer para o cliente final (criativo, mensagem do grupo)
          nome_fachada: farmacia.nomeFachada ?? null,
          farmacia_visivel: nomeVisivel(farmacia),
          cidade:       farmacia.cidade,
          telefone:     farmacia.telefone,
          responsavel:  farmacia.responsavel,
          // link exclusivo deste cliente para escolher os produtos
          link:         links.get(farmacia.id) ?? null,
          // "respondeu" = tem pedido aguardando virar disparo
          respondeu:    Boolean(pendente),
          solicitacao:  pendente ? {
            id:              pendente.id,
            produtos,
            enviado_por:     pendente.enviadoPor,
            criado_em:       pendente.criadoEm,
          } : null,
          // A última lista em QUALQUER status. Depois que o pedido vira
          // campanha ele sai de `solicitacao`, e é daqui que a linha tira o
          // que mostrar: quantos produtos, quem mandou e quando foi atendida.
          ultima_solicitacao: ultima ? {
            id:              ultima.id,
            produtos:        listaDe(ultima.produtosJson),
            enviado_por:     ultima.enviadoPor,
            status:          ultima.status,
            criado_em:       ultima.criadoEm,
            atendida_em:     ultima.atendidaEm,
          } : null,
          // A campanha mais recente deste cliente (cancelada não conta).
          campanha: campanha ? {
            id:            campanha.id,
            status:        campanha.status,
            agendado_para: campanha.agendadoPara,
            proximo_envio: campanha.proximoEnvio,
            ultimo_envio:  campanha.ultimoEnvio,
            criado_em:     campanha.criadoEm,
          } : null,
          ultimo_envio_em: ultimoEnvioEm,
        };
      }),
    );
  });

  /**
   * GET /api/ofertas/ultima-escolha/:farmaciaId
   * O que este cliente escolheu da última vez pelo link dele. Alimenta o
   * passo 3 do disparo, que mostra só esses produtos em vez do banco inteiro.
   * Devolve `null` quando o cliente ainda não enviou nada.
   */
  app.get<{ Params: { farmaciaId: string } }>(
    '/api/ofertas/ultima-escolha/:farmaciaId',
    { preHandler: [autenticar] },
    async (req, reply) => {
      const farmaciaId = parseInt(req.params.farmaciaId, 10);
      if (!Number.isFinite(farmaciaId)) {
        return reply.code(400).send({ detail: 'Farmácia inválida' });
      }

      const ultima = await ofertasRepository.ultimaSolicitacao(req.user.id, farmaciaId);
      if (!ultima) return reply.send(null);

      let produtos: ProdutoSolicitado[] = [];
      try { produtos = JSON.parse(ultima.produtosJson); } catch { /* ignore */ }

      return reply.send({
        id:              ultima.id,
        produtos,
        enviado_por:     ultima.enviadoPor,
        status:          ultima.status,
        criado_em:       ultima.criadoEm,
      });
    },
  );

  /** PATCH /api/ofertas/solicitacoes/:id — muda o status. */
  app.patch<{ Params: { id: string }; Body: { status: string } }>(
    '/api/ofertas/solicitacoes/:id',
    { preHandler: [autenticar] },
    async (req, reply) => {
      const solicitacao = await ofertasRepository.getSolicitacao(parseInt(req.params.id, 10));
      if (!solicitacao) return reply.code(404).send({ detail: 'Solicitação não encontrada' });
      // Admin alcança todas — a carteira dele também lista todas as farmácias,
      // e sem isto o botão de excluir da carteira responderia 403 para ele.
      if (!req.user.isAdmin && solicitacao.gestorId !== req.user.id) {
        return reply.code(403).send({ detail: 'Esta solicitação não pertence a você' });
      }

      const status = req.body?.status;
      if (!['pendente', 'atendida', 'descartada'].includes(status)) {
        return reply.code(400).send({ detail: 'Status inválido' });
      }

      await ofertasRepository.atualizarStatus(solicitacao.id, status);
      return reply.send({ ok: true });
    },
  );

  /** GET /api/ofertas/pendentes — total para o badge do menu. */
  app.get('/api/ofertas/pendentes', { preHandler: [autenticar] }, async (req, reply) => {
    const total = await ofertasRepository.contarPendentes(req.user.id);
    return reply.send({ total });
  });
}
