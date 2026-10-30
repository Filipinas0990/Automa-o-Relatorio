import type { FastifyInstance } from 'fastify';
import { Controller } from '../compartilhado/Controller';
import { RequisicaoInvalida } from '../compartilhado/erros';
import type { Autenticador } from '../auth/Autenticador';
import type { CatalogoService, DadosCadastroProduto, DadosEdicaoProduto } from './CatalogoService';
import type { GuardaSenhaBanco } from './SenhaBancoImagens';

type ComId = { id: string };

/**
 * Rotas HTTP de /api/catalogo — produtos com imagem e o cadastro de categorias.
 *
 * Leitura (lista, imagem, identificar) é de qualquer gestor: o wizard de
 * campanha e o disparo usam o catálogo. Mexer no Banco de Imagens — subir,
 * editar, classificar, ligar/desligar, excluir e baixar — é só do admin E com
 * a senha do servidor (ver SenhaBancoImagens).
 */
export class CatalogoController extends Controller {
  constructor(
    private readonly service: CatalogoService,
    private readonly auth: Autenticador,
    private readonly senha: GuardaSenhaBanco,
  ) {
    super();
  }

  protected rotas(app: FastifyInstance): void {
    const { autenticar, apenasAdmin } = this.auth;
    const comAuth = { preHandler: autenticar };
    const soAdmin = { preHandler: [autenticar, apenasAdmin] };
    // Ordem importa: a senha só é conferida depois de saber que é admin — senão
    // um gestor comum gastaria as tentativas do limitador.
    const adminComSenha = { preHandler: [autenticar, apenasAdmin, this.senha.exigirSenha] };

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
     * Devolve os bytes da imagem para <img src> (o cookie de sessão vai junto).
     */
    app.get('/api/catalogo/produtos/:id/imagem', comAuth, async (request, reply) => {
      const id = this.idProduto(request.params);
      // Cache curto + ETag: a imagem pode ser trocada no editor, e o criativo
      // do disparo é montado a partir desta URL. Passado 1 min, o navegador
      // revalida; se nada mudou, volta 304 sem nem ler a imagem do banco.
      const etag = await this.service.etagImagem(id);
      if (etag) {
        reply.header('ETag', etag).header('Cache-Control', 'private, max-age=60, must-revalidate');
        if (request.headers['if-none-match'] === etag) return reply.code(304).send();
      }
      const img = await this.service.getImagem(id);
      return reply
        .header('Content-Type', img.mime ?? 'image/png')
        .send(Buffer.from(img.imagemB64, 'base64'));
    });

    /**
     * GET /api/catalogo/produtos/:id/download
     * O arquivo da imagem para salvar no computador. Separado da rota acima
     * porque esta exige a senha do banco; a de cima alimenta os <img> do wizard.
     */
    app.get('/api/catalogo/produtos/:id/download', adminComSenha, async (request, reply) => {
      const id = this.idProduto(request.params);
      const img = await this.service.getImagem(id);
      return reply
        .header('Content-Type', img.mime ?? 'image/png')
        .header('Content-Disposition', 'attachment')
        .header('Cache-Control', 'no-store')
        .send(Buffer.from(img.imagemB64, 'base64'));
    });

    /**
     * POST /api/catalogo/produtos
     * Admin cadastra/atualiza um produto do catálogo com sua imagem PNG.
     * Body: { nome: string; imagem_b64: string; mime?: string }
     * bodyLimit elevado para aceitar imagens.
     */
    app.post(
      '/api/catalogo/produtos',
      { ...adminComSenha, bodyLimit: 15 * 1024 * 1024 },
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
    app.patch('/api/catalogo/produtos/categoria', adminComSenha, async (request) => {
      const body = request.body as { ids?: unknown; categoria?: unknown } | undefined;
      const total = await this.service.classificarEmLote(body?.ids, body?.categoria);
      return { ok: true, total };
    });

    /**
     * PATCH /api/catalogo/produtos/:id
     * Admin edita um produto: liga/desliga, renomeia ou troca a categoria.
     * Body: { nome?: string; categoria?: string | null; ativo?: boolean }
     */
    app.patch('/api/catalogo/produtos/:id', adminComSenha, async (request) => {
      const id = this.idProduto(request.params);
      const body = (request.body ?? {}) as DadosEdicaoProduto;
      await this.service.editarProduto(id, body);
      return { ok: true, ativo: body.ativo };
    });

    /**
     * PUT /api/catalogo/produtos/:id/imagem
     * Admin troca a imagem de um produto (resultado do editor de imagem).
     * Body: { imagem_b64: string; mime: 'image/png' | 'image/jpeg' | 'image/webp' }
     */
    app.put(
      '/api/catalogo/produtos/:id/imagem',
      { ...adminComSenha, bodyLimit: 15 * 1024 * 1024 },
      async (request) => {
        const id = this.idProduto(request.params);
        const body = request.body as { imagem_b64?: unknown; mime?: unknown } | undefined;
        await this.service.trocarImagem(id, body?.imagem_b64, body?.mime);
        return { ok: true };
      },
    );

    /** DELETE /api/catalogo/produtos/:id — admin remove um produto do catálogo. */
    app.delete('/api/catalogo/produtos/:id', adminComSenha, async (request) => {
      await this.service.deletarProduto(this.idProduto(request.params));
      return { ok: true };
    });
  }

  /** Id de produto: inteiro positivo, senão 400. */
  private idProduto(params: unknown): number {
    const id = parseInt((params as ComId).id, 10);
    if (!Number.isInteger(id) || id <= 0) throw new RequisicaoInvalida('id inválido.');
    return id;
  }

  /** Id de categoria: inteiro positivo, senão 400 (mesma trava das rotas antigas). */
  private idCategoria(params: unknown): number {
    const id = parseInt((params as ComId).id, 10);
    if (!Number.isInteger(id) || id <= 0) throw new RequisicaoInvalida('id inválido.');
    return id;
  }
}
