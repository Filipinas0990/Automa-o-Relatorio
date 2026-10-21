import type { FastifyInstance } from 'fastify';
import { nomeVisivel } from '../database/schema';
import { Controller } from '../compartilhado/Controller';
import type { Autenticador } from '../auth/Autenticador';
import type { CarteiraService } from './CarteiraService';
import type { LinkOfertaService } from './LinkOfertaService';
import { ListaDoDono } from './ListaDoDono';
import type { SolicitacaoService } from './SolicitacaoService';
import { LIMITE_PRODUTOS_CLIENTE } from './ProdutoClienteService';
import type { ProdutoClienteService } from './ProdutoClienteService';

/** Rotas do gestor para as ofertas que os clientes mandam (/api/ofertas/*). */
export class OfertaController extends Controller {
  constructor(
    private readonly links: LinkOfertaService,
    private readonly solicitacoes: SolicitacaoService,
    private readonly carteira: CarteiraService,
    private readonly auth: Autenticador,
    private readonly produtosCliente: ProdutoClienteService,
  ) {
    super();
  }

  protected rotas(app: FastifyInstance): void {
    const comAuth = { preHandler: [this.auth.autenticar] };

    /** Troca o token daquele cliente — o link antigo para de funcionar na hora. */
    app.post<{ Params: { farmaciaId: string } }>('/api/ofertas/link/:farmaciaId/regenerar', comAuth, async (req) => {
      return this.links.regenerarPara(req.user, parseInt(req.params.farmaciaId, 10));
    });

    /** O que os clientes enviaram. */
    app.get('/api/ofertas/solicitacoes', comAuth, async (req) => {
      return (await this.solicitacoes.listar(req.user)).map((s) => ({
        id:          s.id,
        farmacia_id: s.farmaciaId,
        farmacia:    s.farmacia,
        produtos:    ListaDoDono.ler(s.produtosJson),
        enviado_por: s.enviadoPor,
        status:      s.status,
        criado_em:   s.criadoEm,
        atendida_em: s.atendidaEm,
      }));
    });

    /**
     * Todas as farmácias do gestor com o estado de resposta de cada uma.
     * Alimenta o painel de acompanhamento (passo 2 do disparo).
     */
    app.get('/api/ofertas/carteira', comAuth, async (req) => {
      return (await this.carteira.doGestor(req.user)).map(({ farmacia, pendente, ultima, link, campanha }) => ({
        farmacia_id:      farmacia.id,
        farmacia:         farmacia.nome,
        // O que pode aparecer para o cliente final (criativo, mensagem do grupo)
        nome_fachada:     farmacia.nomeFachada ?? null,
        farmacia_visivel: nomeVisivel(farmacia),
        cidade:           farmacia.cidade,
        telefone:         farmacia.telefone,
        responsavel:      farmacia.responsavel,
        link,
        respondeu:        Boolean(pendente),
        solicitacao: pendente ? {
          id:          pendente.id,
          produtos:    ListaDoDono.ler(pendente.produtosJson),
          enviado_por: pendente.enviadoPor,
          criado_em:   pendente.criadoEm,
        } : null,
        // Depois que o pedido vira campanha ele sai de `solicitacao`, e é daqui
        // que a linha tira o que mostrar.
        ultima_solicitacao: ultima ? {
          id:          ultima.id,
          produtos:    ListaDoDono.ler(ultima.produtosJson),
          enviado_por: ultima.enviadoPor,
          status:      ultima.status,
          criado_em:   ultima.criadoEm,
          atendida_em: ultima.atendidaEm,
        } : null,
        campanha: campanha ? {
          id:            campanha.id,
          status:        campanha.status,
          agendado_para: campanha.agendadoPara,
          proximo_envio: campanha.proximoEnvio,
          ultimo_envio:  campanha.ultimoEnvio,
          criado_em:     campanha.criadoEm,
        } : null,
        ultimo_envio_em: ultima?.criadoEm ?? null,
      }));
    });

    /**
     * O que este cliente escolheu da última vez pelo link dele. Alimenta o
     * passo 3 do disparo. `null` quando o cliente ainda não enviou nada.
     */
    app.get<{ Params: { farmaciaId: string } }>('/api/ofertas/ultima-escolha/:farmaciaId', comAuth, async (req, reply) => {
      const ultima = await this.solicitacoes.ultimaEscolha(req.user, parseInt(req.params.farmaciaId, 10));
      if (!ultima) return reply.send(null);
      return {
        id:          ultima.id,
        produtos:    ListaDoDono.ler(ultima.produtosJson),
        enviado_por: ultima.enviadoPor,
        status:      ultima.status,
        criado_em:   ultima.criadoEm,
      };
    });

    app.patch<{ Params: { id: string }; Body: { status?: string } }>('/api/ofertas/solicitacoes/:id', comAuth, async (req) => {
      await this.solicitacoes.mudarStatus(req.user, parseInt(req.params.id, 10), req.body?.status);
      return { ok: true };
    });

    /** Vitrine: tudo o que os clientes da carteira mandaram pelo link, com quem mandou. */
    app.get('/api/ofertas/produtos-clientes', comAuth, async (req) => {
      const itens = await this.produtosCliente.daCarteira(req.user);
      return {
        limite: LIMITE_PRODUTOS_CLIENTE,
        itens:  itens.map((p) => ({
          id:               p.id,
          nome:             p.nome,
          criado_em:        p.criadoEm,
          farmacia_id:      p.farmaciaId,
          farmacia:         p.farmacia,
          farmacia_visivel: p.farmaciaVisivel,
          cidade:           p.cidade,
        })),
      };
    });

    /** Os produtos que o cliente mandou pelo link (foto + nome), até o limite. */
    app.get<{ Params: { farmaciaId: string } }>('/api/ofertas/clientes/:farmaciaId/produtos', comAuth, async (req) => {
      const farmaciaId = await this.produtosCliente.farmaciaDoGestor(req.user, parseInt(req.params.farmaciaId, 10));
      const itens = await this.produtosCliente.listar(farmaciaId);
      return {
        limite: LIMITE_PRODUTOS_CLIENTE,
        itens:  itens.map((p) => ({ id: p.id, nome: p.nome, criado_em: p.criadoEm })),
      };
    });

    app.get<{ Params: { farmaciaId: string; id: string } }>(
      '/api/ofertas/clientes/:farmaciaId/produtos/:id/imagem',
      comAuth,
      async (req, reply) => {
        const farmaciaId = await this.produtosCliente.farmaciaDoGestor(req.user, parseInt(req.params.farmaciaId, 10));
        const foto = await this.produtosCliente.foto(farmaciaId, parseInt(req.params.id, 10));
        return reply
          .header('Content-Type', foto.mime)
          .header('Cache-Control', 'private, max-age=86400')
          .send(Buffer.from(foto.imagemB64, 'base64'));
      },
    );

    /** Total para o badge do menu. */
    app.get('/api/ofertas/pendentes', comAuth, async (req) => {
      return { total: await this.solicitacoes.pendentes(req.user) };
    });
  }
}
