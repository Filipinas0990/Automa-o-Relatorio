import type { Farmacia, Gestor } from '../database/schema';
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
}

/** O que a carteira precisa saber dos disparos. */
export interface CampanhasDosClientes {
  ultimaCampanhaPorFarmacia(gestorId: number): Promise<Map<number, CampanhaResumo>>;
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
    // Admin vê todas — senão o pedido que chegou pelo link dele ficaria órfão.
    const [lista, solicitacoes] = await Promise.all([
      this.farmacias.listarAtivas(quem.isAdmin ? null : quem.id),
      this.solicitacoes.listarDoGestor(quem.id),
    ]);
    const [links, campanhas] = await Promise.all([
      this.links.daCarteira(quem.id, lista.map((f) => f.id)),
      this.campanhas.ultimaCampanhaPorFarmacia(quem.id),
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
