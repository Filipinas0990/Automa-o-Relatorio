import type { Farmacia, Gestor } from '../database/schema';
import { gestorDoEscopo } from '../compartilhado/Escopo';
import type { FarmaciaRepository } from '../farmacias/FarmaciaRepository';
import type { LinkOfertaService } from './LinkOfertaService';
import type { SolicitacaoComFarmacia, SolicitacaoRepository } from './SolicitacaoRepository';

export interface CampanhaResumo {
  id:           number;
  status:       string;
  agendadoPara: Date | null;
  proximoEnvio: Date | null;
  ultimoEnvio:  Date | null;
  criadoEm:     Date | null;
  /** Quem programou — o admin vê campanha de todos os gestores. */
  gestorNome:   string | null;
}

/** O que a carteira precisa saber dos disparos. */
export interface CampanhasDosClientes {
  ultimaCampanhaPorFarmacia(gestorId: number | null): Promise<Map<number, CampanhaResumo>>;
}

export interface LinhaCarteira {
  farmacia: Farmacia;
  /** Pedido aguardando virar disparo — é o que conta como "respondeu". */
  pendente: SolicitacaoComFarmacia | null;
  /** A última lista em qualquer status (menos descartada). */
  ultima:   SolicitacaoComFarmacia | null;
  /** Link exclusivo deste cliente. */
  link:     string | null;
  /** A campanha mais recente (cancelada não conta). */
  campanha: CampanhaResumo | null;
}

/**
 * A carteira do gestor: TODAS as farmácias dele, cada uma com o pedido
 * pendente (se houver), o link e a última campanha. É o inverso da caixa de
 * entrada — o gestor precisa ver quem NÃO respondeu para poder cobrar.
 *
 * "Respondeu" = tem solicitação pendente. Depois que o disparo sai, ela vira
 * 'atendida' e o cliente volta a aparecer como sem resposta, pronto para a
 * lista do próximo ciclo.
 */
export class CarteiraService {
  constructor(
    private readonly farmacias: FarmaciaRepository,
    private readonly solicitacoes: SolicitacaoRepository,
    private readonly links: LinkOfertaService,
    private readonly campanhas: CampanhasDosClientes,
  ) {}

  async doGestor(quem: Gestor): Promise<LinhaCarteira[]> {
    // Admin vê TUDO: todas as farmácias, as listas que chegaram para qualquer
    // gestor e a campanha que qualquer gestor programou. O link continua o do
    // próprio admin — é ele quem manda para o cliente.
    const escopo = gestorDoEscopo(quem);
    const [lista, solicitacoes] = await Promise.all([
      this.farmacias.listarAtivas(escopo),
      this.solicitacoes.listarDoGestor(escopo),
    ]);
    const [links, campanhas] = await Promise.all([
      this.links.daCarteira(quem.id, lista.map((f) => f.id)),
      this.campanhas.ultimaCampanhaPorFarmacia(escopo),
    ]);

    return lista.map((farmacia) => {
      // listarDoGestor já vem por data desc
      const daFarmacia = solicitacoes.filter((s) => s.farmaciaId === farmacia.id);
      return {
        farmacia,
        pendente: daFarmacia.find((s) => s.status === 'pendente') ?? null,
        // Descartada é lista que o gestor mandou excluir: não volta como "última".
        ultima:   daFarmacia.find((s) => s.status !== 'descartada') ?? null,
        link:     links.get(farmacia.id) ?? null,
        campanha: campanhas.get(farmacia.id) ?? null,
      };
    });
  }
}
