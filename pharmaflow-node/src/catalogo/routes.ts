import type { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from 'fastify';
import {
  identificarProdutos, upsertProduto, contarProdutos,
  listarProdutos, getImagem, deletarProduto,
  type ProdutoEntrada,
} from './repository';

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
    Body: { nome: string; imagem_b64: string; mime?: string };
  }>(
    '/api/catalogo/produtos',
    { preHandler: [autenticar, apenasAdmin], bodyLimit: 15 * 1024 * 1024 },
    async (req, reply) => {
      const { nome, imagem_b64, mime } = req.body ?? {};
      if (!nome?.trim() || !imagem_b64?.trim()) {
        return reply.code(400).send({ detail: 'nome e imagem_b64 são obrigatórios.' });
      }
      // Remove o prefixo data: se vier junto
      const b64 = imagem_b64.includes(',') ? imagem_b64.split(',')[1] : imagem_b64;
      await upsertProduto(nome.trim(), b64, mime ?? 'image/png');
      return reply.code(201).send({ ok: true });
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
