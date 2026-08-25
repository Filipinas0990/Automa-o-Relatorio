import type { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from 'fastify';
import {
  identificarProdutos, upsertProduto, contarProdutos,
  listarProdutos, getImagem, deletarProduto, setAtivo, setCategoriaEmLote,
  garantirCategoria,
  listarCategorias, criarCategoria, renomearCategoria, excluirCategoria,
  type ProdutoEntrada,
} from './repository';
import { limparCategoria } from './categorias';

type Middleware = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

interface CatalogoRouteOptions extends FastifyPluginOptions {
  autenticar:  Middleware;
  apenasAdmin: Middleware;
}

export async function catalogoRoutes(
  app:  FastifyInstance,
  opts: CatalogoRouteOptions,
): Promise<void> {
  const { autenticar, apenasAdmin } = opts;

  /**
   * POST /api/catalogo/identificar
   * Recebe a lista de produtos lida da planilha e devolve cada um casado com a
   * imagem do catálogo (ou marcado como não encontrado).
   * Body: { produtos: [{ nome: string; preco?: string }] }
   */
  app.post<{
    Body: { produtos: ProdutoEntrada[] };
  }>(
    '/api/catalogo/identificar',
    { preHandler: [autenticar] },
    async (req, reply) => {
      const produtos = Array.isArray(req.body?.produtos) ? req.body.produtos : [];
      if (produtos.length === 0) {
        return reply.code(400).send({ detail: 'Envie ao menos um produto em "produtos".' });
      }
      const resultado = await identificarProdutos(produtos);
      return reply.send({ produtos: resultado });
    },
  );

  /**
   * GET /api/catalogo/status
   * Quantos produtos existem no catálogo (para exibir no admin).
   */
  app.get(
    '/api/catalogo/status',
    { preHandler: [autenticar] },
    async (_req, reply) => {
      const total = await contarProdutos();
      return reply.send({ total });
    },
  );

  /**
   * GET /api/catalogo/produtos
   * Lista os produtos do catálogo (sem imagem — leve). Usado no modal de gestão.
   */
  app.get(
    '/api/catalogo/produtos',
    { preHandler: [autenticar] },
    async (_req, reply) => {
      const produtos = await listarProdutos();
      return reply.send({ produtos });
    },
  );

  /**
   * GET /api/catalogo/categorias
   * O cadastro de categorias com a contagem de produtos de cada uma. Serve
   * três consumidores: a tela de Categorias (CRUD), as sugestões do campo de
   * digitação e o campo de classificação em lote.
   *
   * `sugestoes` é a mesma lista, só com os nomes. Existe por compatibilidade —
   * antes eram as categorias padrão fixas no código, e quem consome soma as
   * duas e tira as repetidas.
   *
   * Categoria com `total: 0` é normal e não é sujeira: foi criada aqui e ainda
   * não recebeu imagem. Quem monta chip de filtro deve continuar olhando o
   * acervo, não esta lista — chip que não filtra nada é armadilha.
   */
  app.get(
    '/api/catalogo/categorias',
    { preHandler: [autenticar] },
    async (_req, reply) => {
      const categorias = await listarCategorias();
      return reply.send({ categorias, sugestoes: categorias.map((c) => c.nome) });
    },
  );

  /**
   * POST /api/catalogo/categorias
   * Cria uma categoria vazia, antes de existir imagem nela.
   * Body: { nome: string }
   */
  app.post<{ Body: { nome?: unknown } }>(
    '/api/catalogo/categorias',
    { preHandler: [autenticar, apenasAdmin] },
    async (req, reply) => {
      const nome = limparCategoria(req.body?.nome);
      if (nome === undefined) {
        return reply.code(400).send({ detail: 'Nome da categoria deve ser texto.' });
      }
      if (!nome) {
        return reply.code(400).send({ detail: 'Informe o nome da categoria.' });
      }

      const categoria = await criarCategoria(nome);
      if (!categoria) {
        return reply.code(409).send({ detail: `A categoria "${nome}" já existe.` });
      }
      return reply.code(201).send({ ok: true, categoria });
    },
  );

  /**
   * PATCH /api/catalogo/categorias/:id
   * Renomeia a categoria E reescreve a categoria dos produtos que estavam
   * nela — o produto guarda o texto, não um id.
   * Body: { nome: string }
   */
  app.patch<{ Params: { id: string }; Body: { nome?: unknown } }>(
    '/api/catalogo/categorias/:id',
    { preHandler: [autenticar, apenasAdmin] },
    async (req, reply) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id) || id <= 0) {
        return reply.code(400).send({ detail: 'id inválido.' });
      }

      const nome = limparCategoria(req.body?.nome);
      if (nome === undefined) {
        return reply.code(400).send({ detail: 'Nome da categoria deve ser texto.' });
      }
      if (!nome) {
        return reply.code(400).send({ detail: 'Informe o nome da categoria.' });
      }

      const r = await renomearCategoria(id, nome);
      if (!r.ok) {
        return r.motivo === 'nao-existe'
          ? reply.code(404).send({ detail: 'Categoria não encontrada.' })
          : reply.code(409).send({ detail: `Já existe uma categoria "${nome}".` });
      }
      return reply.send({ ok: true, categoria: r.categoria, produtos: r.produtos });
    },
  );

  /**
   * DELETE /api/catalogo/categorias/:id
   * Remove a categoria do cadastro. Os produtos dela ficam SEM categoria —
   * imagem nenhuma é apagada.
   */
  app.delete<{ Params: { id: string } }>(
    '/api/catalogo/categorias/:id',
    { preHandler: [autenticar, apenasAdmin] },
    async (req, reply) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id) || id <= 0) {
        return reply.code(400).send({ detail: 'id inválido.' });
      }

      const r = await excluirCategoria(id);
      if (!r.ok) {
        return reply.code(404).send({ detail: 'Categoria não encontrada.' });
      }
      return reply.send({ ok: true, produtos: r.produtos });
    },
  );

  /**
   * GET /api/catalogo/produtos/:id/imagem
   * Devolve os bytes da imagem. Autentica via header OU ?token= (para usar em <img src>).
   */
  app.get<{ Params: { id: string } }>(
    '/api/catalogo/produtos/:id/imagem',
    { preHandler: [autenticar] },
    async (req, reply) => {
      const id = parseInt(req.params.id, 10);
      const img = await getImagem(id);
      if (!img?.imagemB64) {
        return reply.code(404).send({ detail: 'Imagem não encontrada.' });
      }
      const buffer = Buffer.from(img.imagemB64, 'base64');
      return reply
        .header('Content-Type', img.mime ?? 'image/png')
        .header('Cache-Control', 'private, max-age=3600')
        .send(buffer);
    },
  );

  /**
   * POST /api/catalogo/produtos
   * Admin cadastra/atualiza um produto do catálogo com sua imagem PNG.
   * Body: { nome: string; imagem_b64: string; mime?: string }
   * bodyLimit elevado para aceitar imagens.
   */
  app.post<{
    Body: { nome: string; imagem_b64: string; mime?: string; categoria?: string | null };
  }>(
    '/api/catalogo/produtos',
    { preHandler: [autenticar, apenasAdmin], bodyLimit: 15 * 1024 * 1024 },
    async (req, reply) => {
      const { nome, imagem_b64, mime, categoria } = req.body ?? {};
      if (!nome?.trim() || !imagem_b64?.trim()) {
        return reply.code(400).send({ detail: 'nome e imagem_b64 são obrigatórios.' });
      }

      // Categoria é texto livre e opcional — o modal deixa subir sem classificar.
      // `undefined` (campo ausente) preserva a categoria de um produto que já
      // existe; string vazia limpa. Só o tipo errado é recusado.
      let categoriaFinal: string | null | undefined;
      if (categoria !== undefined) {
        const limpa = limparCategoria(categoria);
        if (limpa === undefined) {
          return reply.code(400).send({ detail: 'Categoria deve ser texto.' });
        }
        categoriaFinal = await garantirCategoria(limpa);
      }

      // Remove o prefixo data: se vier junto
      const b64 = imagem_b64.includes(',') ? imagem_b64.split(',')[1] : imagem_b64;
      await upsertProduto(nome.trim(), b64, mime ?? 'image/png', categoriaFinal);
      return reply.code(201).send({ ok: true });
    },
  );

  /**
   * PATCH /api/catalogo/produtos/categoria
   * Admin classifica um ou vários produtos de uma vez.
   * Body: { ids: number[]; categoria: string | null }  (null limpa a categoria)
   *
   * Rota estática antes da paramétrica `/produtos/:id` — o Fastify já dá
   * precedência ao segmento estático, então "categoria" nunca cai como id.
   */
  app.patch<{ Body: { ids?: unknown; categoria?: unknown } }>(
    '/api/catalogo/produtos/categoria',
    { preHandler: [autenticar, apenasAdmin] },
    async (req, reply) => {
      const { ids, categoria } = req.body ?? {};

      if (!Array.isArray(ids) || ids.length === 0) {
        return reply.code(400).send({ detail: 'Envie ao menos um id em "ids".' });
      }
      const limpos = ids
        .map((v) => (typeof v === 'number' ? v : parseInt(String(v), 10)))
        .filter((n) => Number.isInteger(n) && n > 0);
      if (limpos.length !== ids.length) {
        return reply.code(400).send({ detail: 'A lista "ids" tem valores que não são id de produto.' });
      }
      // Teto para não transformar um bug de front num UPDATE no acervo inteiro.
      if (limpos.length > 500) {
        return reply.code(400).send({ detail: 'Classifique no máximo 500 produtos por vez.' });
      }
      if (categoria === undefined) {
        return reply.code(400).send({ detail: 'Envie o campo "categoria" (texto, ou null para limpar).' });
      }
      const limpa = limparCategoria(categoria);
      if (limpa === undefined) {
        return reply.code(400).send({ detail: 'Categoria deve ser texto.' });
      }

      const total = await setCategoriaEmLote(limpos, await garantirCategoria(limpa));
      return reply.send({ ok: true, total });
    },
  );

  /**
   * PATCH /api/catalogo/produtos/:id
   * Admin liga/desliga um produto do catálogo.
   * Body: { ativo: boolean }
   * Produto desligado deixa de entrar nos criativos e não é oferecido.
   */
  app.patch<{ Params: { id: string }; Body: { ativo?: boolean } }>(
    '/api/catalogo/produtos/:id',
    { preHandler: [autenticar, apenasAdmin] },
    async (req, reply) => {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        return reply.code(400).send({ detail: 'id inválido.' });
      }
      if (typeof req.body?.ativo !== 'boolean') {
        return reply.code(400).send({ detail: 'Campo "ativo" (boolean) é obrigatório.' });
      }
      const existe = await setAtivo(id, req.body.ativo);
      if (!existe) {
        return reply.code(404).send({ detail: 'Produto não encontrado.' });
      }
      return reply.send({ ok: true, ativo: req.body.ativo });
    },
  );

  /**
   * DELETE /api/catalogo/produtos/:id
   * Admin remove um produto do catálogo.
   */
  app.delete<{ Params: { id: string } }>(
    '/api/catalogo/produtos/:id',
    { preHandler: [autenticar, apenasAdmin] },
    async (req, reply) => {
      const id = parseInt(req.params.id, 10);
      await deletarProduto(id);
      return reply.send({ ok: true });
    },
  );
}
