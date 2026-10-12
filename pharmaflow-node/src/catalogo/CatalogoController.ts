import type { FastifyInstance } from 'fastify';
import { Controller } from '../compartilhado/Controller';
import { RequisicaoInvalida } from '../compartilhado/erros';
import type { Autenticador } from '../auth/Autenticador';
import type { CatalogoService, DadosCadastroProduto } from './CatalogoService';

type ComId = { id: string };

/** Rotas HTTP de /api/catalogo — produtos com imagem e o cadastro de categorias. */
export class CatalogoController extends Controller {
  constructor(
    private readonly service: CatalogoService,
    private readonly auth: Autenticador,
  ) {
    super();
  }

  protected rotas(app: FastifyInstance): void {
    const { autenticar, apenasAdmin } = this.auth;
    const comAuth = { preHandler: autenticar };
    const soAdmin = { preHandler: [autenticar, apenasAdmin] };

    /**
     * POST /api/catalogo/identificar
     * Recebe a lista de produtos lida da planilha e devolve cada um casado com a
     * imagem do catálogo (ou marcado como não encontrado).
     * Body: { produtos: [{ nome: string; preco?: string }] }
     */
    app.post('/api/catalogo/identificar', comAuth, async (request) => {
      const body = request.body as { produtos?: unknown } | undefined;
      const produtos = await this.service.identificarProdutos(body?.produtos);
      return { produtos };
    });

    /** GET /api/catalogo/status — quantos produtos existem no catálogo. */
    app.get('/api/catalogo/status', comAuth, async () => {
      return { total: await this.service.contarProdutos() };
    });

    /** GET /api/catalogo/produtos — lista os produtos do catálogo (sem imagem). */
    app.get('/api/catalogo/produtos', comAuth, async () => {
      return { produtos: await this.service.listarProdutos() };
    });

    /**
     * GET /api/catalogo/categorias
     * O cadastro de categorias com a contagem de produtos de cada uma.
     * `sugestoes` é a mesma lista, só com os nomes (compatibilidade).
     */
    app.get('/api/catalogo/categorias', comAuth, async () => {
      const categorias = await this.service.listarCategorias();
      return { categorias, sugestoes: categorias.map((c) => c.nome) };
    });

    /**
     * POST /api/catalogo/categorias
     * Cria uma categoria vazia, antes de existir imagem nela.
     * Body: { nome: string }
     */
    app.post('/api/catalogo/categorias', soAdmin, async (request, reply) => {
      const body = request.body as { nome?: unknown } | undefined;
      const categoria = await this.service.criarCategoria(body?.nome);
      return reply.code(201).send({ ok: true, categoria });
    });

    /**
     * PATCH /api/catalogo/categorias/:id
     * Renomeia a categoria E reescreve a categoria dos produtos que estavam nela.
     * Body: { nome: string }
     */
    app.patch('/api/catalogo/categorias/:id', soAdmin, async (request) => {
      const id = this.idCategoria(request.params);
      const body = request.body as { nome?: unknown } | undefined;
      const { categoria, produtos } = await this.service.renomearCategoria(id, body?.nome);
      return { ok: true, categoria, produtos };
    });

    /**
     * DELETE /api/catalogo/categorias/:id
     * Remove a categoria do cadastro. Os produtos dela ficam SEM categoria.
     */
    app.delete('/api/catalogo/categorias/:id', soAdmin, async (request) => {
      const id = this.idCategoria(request.params);
      const { produtos } = await this.service.excluirCategoria(id);
      return { ok: true, produtos };
    });

    /**
     * GET /api/catalogo/produtos/:id/imagem
     * Devolve os bytes da imagem. Autentica via header OU ?token= (para usar em <img src>).
     */
    app.get('/api/catalogo/produtos/:id/imagem', comAuth, async (request, reply) => {
      const id = parseInt((request.params as ComId).id, 10);
      const img = await this.service.getImagem(id);
      const buffer = Buffer.from(img.imagemB64, 'base64');
      return reply
        .header('Content-Type', img.mime ?? 'image/png')
        .header('Cache-Control', 'private, max-age=3600')
        .send(buffer);
    });

    /**
     * POST /api/catalogo/produtos
     * Admin cadastra/atualiza um produto do catálogo com sua imagem PNG.
     * Body: { nome: string; imagem_b64: string; mime?: string }
     * bodyLimit elevado para aceitar imagens.
     */
    app.post(
      '/api/catalogo/produtos',
      { preHandler: [autenticar, apenasAdmin], bodyLimit: 15 * 1024 * 1024 },
      async (request, reply) => {
        await this.service.cadastrarProduto(request.body as DadosCadastroProduto);
        return reply.code(201).send({ ok: true });
      },
    );

    /**
     * PATCH /api/catalogo/produtos/categoria
     * Admin classifica um ou vários produtos de uma vez.
     * Body: { ids: number[]; categoria: string | null }
     *
     * Rota estática antes da paramétrica `/produtos/:id` — o Fastify já dá
     * precedência ao segmento estático, então "categoria" nunca cai como id.
     */
    app.patch('/api/catalogo/produtos/categoria', soAdmin, async (request) => {
      const body = request.body as { ids?: unknown; categoria?: unknown } | undefined;
      const total = await this.service.classificarEmLote(body?.ids, body?.categoria);
      return { ok: true, total };
    });

    /**
     * PATCH /api/catalogo/produtos/:id
     * Admin liga/desliga um produto do catálogo.
     * Body: { ativo: boolean }
     */
    app.patch('/api/catalogo/produtos/:id', soAdmin, async (request) => {
      const id = parseInt((request.params as ComId).id, 10);
      if (Number.isNaN(id)) throw new RequisicaoInvalida('id inválido.');
      const body = request.body as { ativo?: unknown } | undefined;
      await this.service.setAtivo(id, body?.ativo);
      return { ok: true, ativo: body?.ativo };
    });

    /** DELETE /api/catalogo/produtos/:id — admin remove um produto do catálogo. */
    app.delete('/api/catalogo/produtos/:id', soAdmin, async (request) => {
      const id = parseInt((request.params as ComId).id, 10);
      await this.service.deletarProduto(id);
      return { ok: true };
    });
  }

  /** Id de categoria: inteiro positivo, senão 400 (mesma trava das rotas antigas). */
  private idCategoria(params: unknown): number {
    const id = parseInt((params as ComId).id, 10);
    if (!Number.isInteger(id) || id <= 0) throw new RequisicaoInvalida('id inválido.');
    return id;
  }
}
