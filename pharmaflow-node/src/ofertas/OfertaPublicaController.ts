import type { FastifyInstance } from 'fastify';
import { nomeVisivel } from '../database/schema';
import { Controller } from '../compartilhado/Controller';
import { NaoEncontrado, RequisicaoInvalida } from '../compartilhado/erros';
import type { FarmaciaRepository } from '../farmacias/FarmaciaRepository';
import type { LinkAberto, LinkOfertaService } from './LinkOfertaService';
import type { EnvioDoDono, ProdutosDoCatalogo, SolicitacaoService } from './SolicitacaoService';
import { LIMITE_PRODUTOS_CLIENTE } from './ProdutoClienteService';
import type { EnvioDeProduto, ProdutoClienteService } from './ProdutoClienteService';

/** Foto do produto, como o catálogo guarda. */
export interface ImagensDoCatalogo {
  getImagem(id: number): Promise<{ imagemB64: string | null; mime: string | null } | null>;
}

type ComToken = { Params: { token: string } };
type ComProduto = { Params: { token: string; id: string } };

/** A foto chega em base64 (~4/3 do arquivo): folga sobre o teto do service. */
const LIMITE_CORPO_FOTO = 1.5 * 1024 * 1024;

/**
 * Rotas PÚBLICAS do link de ofertas (/api/publico/ofertas/*), usadas pelo dono
 * da farmácia sem login. O token do link é a credencial (mesmo princípio do
 * webhook da Evolution): tudo o que elas devolvem deriva do token, então um
 * link só alcança as farmácias do gestor que o gerou.
 */
export class OfertaPublicaController extends Controller {
  constructor(
    private readonly links: LinkOfertaService,
    private readonly solicitacoes: SolicitacaoService,
    private readonly farmacias: FarmaciaRepository,
    private readonly catalogo: ProdutosDoCatalogo & ImagensDoCatalogo,
    private readonly produtosCliente: ProdutoClienteService,
  ) {
    super();
  }

  protected rotas(app: FastifyInstance): void {
    /**
     * Abre o link: quem é o gestor, a farmácia do cliente e o catálogo ativo.
     * Nos links legados (sem farmácia) vem a lista para o dono escolher.
     */
    app.get<ComToken>('/api/publico/ofertas/:token', async (req) => {
      const link = await this.abrir(req.params.token);
      const [lista, produtos, meus] = await Promise.all([
        // Link de cliente não expõe as outras farmácias da carteira.
        link.farmacia ? [] : this.farmacias.listarAtivas(link.gestor.isAdmin ? null : link.gestor.id),
        this.catalogo.listarProdutos(),
        // O espaço de produtos próprios é da farmácia: só existe no link de cliente.
        link.farmacia ? this.produtosCliente.listar(link.farmacia.id) : [],
      ]);

      return {
        gestor:    { nome: link.gestor.nome },
        farmacia:  link.farmacia
          ? { id: link.farmacia.id, nome: nomeVisivel(link.farmacia), cidade: link.farmacia.cidade }
          : null,
        farmacias: lista.map((f) => ({ id: f.id, nome: nomeVisivel(f), cidade: f.cidade })),
        produtos:  produtos
          .filter((p) => p.ativo)
          .map((p) => ({ id: p.id, nome: p.nome, categoria: p.categoria })),
        // null = link legado, sem espaço de produtos próprios.
        meus_produtos: link.farmacia
          ? { limite: LIMITE_PRODUTOS_CLIENTE, itens: meus.map((p) => ({ id: p.id, nome: p.nome })) }
          : null,
      };
    });

    /** Foto do produto — o dono precisa ver o que está escolhendo. */
    app.get<{ Params: { token: string; id: string } }>(
      '/api/publico/ofertas/:token/produto/:id/imagem',
      async (req, reply) => {
        await this.abrir(req.params.token);
        const img = await this.catalogo.getImagem(parseInt(req.params.id, 10));
        if (!img?.imagemB64) throw new NaoEncontrado('Sem imagem');

        return reply
          .header('Content-Type', img.mime || 'image/png')
          .header('Cache-Control', 'public, max-age=86400')
          .send(Buffer.from(img.imagemB64, 'base64'));
      },
    );

    /** O dono manda um produto dele (foto + nome) para o espaço da farmácia. */
    app.post<ComToken & { Body: EnvioDeProduto }>(
      '/api/publico/ofertas/:token/meus-produtos',
      { bodyLimit: LIMITE_CORPO_FOTO },
      async (req, reply) => {
        const farmaciaId = this.farmaciaDoLink(await this.abrir(req.params.token));
        const p = await this.produtosCliente.enviar(farmaciaId, req.body);
        return reply.code(201).send({ id: p.id, nome: p.nome });
      },
    );

    app.get<ComProduto>('/api/publico/ofertas/:token/meus-produtos/:id/imagem', async (req, reply) => {
      const farmaciaId = this.farmaciaDoLink(await this.abrir(req.params.token));
      const foto = await this.produtosCliente.foto(farmaciaId, parseInt(req.params.id, 10));
      return reply
        .header('Content-Type', foto.mime)
        // O id nunca é reaproveitado para outra foto, então pode guardar.
        .header('Cache-Control', 'private, max-age=86400')
        .send(Buffer.from(foto.imagemB64, 'base64'));
    });

    /** Libera a vaga: o dono exclui um produto que mandou. */
    app.delete<ComProduto>('/api/publico/ofertas/:token/meus-produtos/:id', async (req) => {
      const farmaciaId = this.farmaciaDoLink(await this.abrir(req.params.token));
      await this.produtosCliente.excluir(farmaciaId, parseInt(req.params.id, 10));
      return { ok: true };
    });

    /** O dono envia a seleção. */
    app.post<ComToken & { Body: EnvioDoDono }>('/api/publico/ofertas/:token', async (req, reply) => {
      const link = await this.abrir(req.params.token);
      const solicitacao = await this.solicitacoes.receber(link, req.body);
      return reply.code(201).send({ ok: true, id: solicitacao.id });
    });
  }

  /** Produtos próprios ficam no espaço da farmácia, que o link legado não tem. */
  private farmaciaDoLink(link: LinkAberto): number {
    if (!link.farmacia) throw new RequisicaoInvalida('Este link não permite enviar produtos. Peça o link novo ao seu gestor.');
    return link.farmacia.id;
  }

  /** 404 genérico: não revela se o token existe mas está inativo. */
  private async abrir(token: string): Promise<LinkAberto> {
    const link = await this.links.abrir(token);
    if (!link) throw new NaoEncontrado('Link inválido ou expirado.');
    return link;
  }
}
