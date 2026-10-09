/** Linha de canal como vem do banco (somas do coleta_canais). */
export type LinhaCanal = {
  canal: string;
  total_atendimentos: number | string | null;
  total_vendas: number | string | null;
  total_receita_vendas: number | string | null;
};

export interface ResumoCanal {
  nome: string;
  atendimentos: number;
  vendas: number;
  receita_vendas: number;
}

/**
 * Soma os canais de venda sob nomes padronizados: a plataforma chama o mesmo
 * canal de jeitos diferentes ("Facebook", "Instagram Ads"...), e o painel
 * mostra só Google, Meta e Grupos (o resto passa com o nome original).
 */
export class AgregadorCanais {
  private readonly totais = new Map<string, { atendimentos: number; vendas: number; receita_vendas: number }>();

  static nomePadrao(canal: string): string {
    const n = canal.toLowerCase();
    if (n.includes('google'))                                                     return 'Google';
    if (n.includes('facebook') || n.includes('instagram') || n.includes('meta')) return 'Meta';
    if (n.includes('grupo') || n.includes('oferta') || n.includes('group'))      return 'Grupos';
    return canal;
  }

  somar(linha: LinhaCanal): void {
    const nome = AgregadorCanais.nomePadrao(linha.canal);
    const t = this.totais.get(nome) ?? { atendimentos: 0, vendas: 0, receita_vendas: 0 };
    t.atendimentos   += parseInt(String(linha.total_atendimentos || 0));
    t.vendas         += parseInt(String(linha.total_vendas || 0));
    t.receita_vendas += parseFloat(String(linha.total_receita_vendas || 0));
    this.totais.set(nome, t);
  }

  /** Canais do mais atendido para o menos, com a receita em centavos redondos. */
  resumo(): ResumoCanal[] {
    return [...this.totais.entries()]
      .sort((a, b) => b[1].atendimentos - a[1].atendimentos)
      .map(([nome, d]) => ({
        nome,
        atendimentos:   d.atendimentos,
        vendas:         d.vendas,
        receita_vendas: Math.round(d.receita_vendas * 100) / 100,
      }));
  }
}
