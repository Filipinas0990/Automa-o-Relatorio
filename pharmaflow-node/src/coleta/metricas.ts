import { AgregadorCanais } from '../farmacias/AgregadorCanais';
import type { Metricas } from '../types';

/** Totais de uma origem num período. */
export interface Totais { atendimentos: number; vendas: number; receita: number }

export const ZERO: Totais = { atendimentos: 0, vendas: 0, receita: 0 };

/** Soma linhas por origem crua (a mesma origem pode vir repetida). */
export function porOrigem(linhas: ({ origem: string } & Totais)[]): Map<string, Totais> {
  const m = new Map<string, Totais>();
  for (const l of linhas) {
    const t = m.get(l.origem) ?? { ...ZERO };
    t.atendimentos += l.atendimentos;
    t.vendas += l.vendas;
    t.receita += l.receita;
    m.set(l.origem, t);
  }
  return m;
}

export function somar(lista: Totais[]): Totais {
  return lista.reduce((s, t) => ({
    atendimentos: s.atendimentos + t.atendimentos, vendas: s.vendas + t.vendas, receita: s.receita + t.receita,
  }), { ...ZERO });
}

/** Entradas do score: atendimentos por canal padronizado (Google, Meta, Grupos) + totais. */
export function metricas(origens: Map<string, Totais>): Metricas {
  const canal = (nome: string) => somar([...origens.entries()]
    .filter(([origem]) => AgregadorCanais.nomePadrao(origem) === nome).map(([, t]) => t)).atendimentos;
  const total = somar([...origens.values()]);
  return {
    clientesGoogle:       canal('Google'),
    clientesFacebook:     canal('Meta'),
    clientesGruposOferta: canal('Grupos'),
    vendasRealizadas:     total.vendas,
    receitaTotal:         total.receita,
  };
}
