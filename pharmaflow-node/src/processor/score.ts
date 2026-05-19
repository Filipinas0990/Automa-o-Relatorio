import type { Metricas, ScoreInfo } from '../types';

function variacao(atual: number, anterior: number): number {
  if (anterior === 0) return 0;
  return ((atual - anterior) / anterior) * 100;
}

export function calcularScore(atual: Metricas, anterior: Metricas | null): ScoreInfo {
  let score = 0;
  const alertas: string[] = [];
  let varGoogle = 0, varFacebook = 0, varGrupos = 0, varVendas = 0, varReceita = 0;

  if (anterior) {
    varGoogle   = variacao(atual.clientesGoogle,       anterior.clientesGoogle);
    varFacebook = variacao(atual.clientesFacebook,     anterior.clientesFacebook);
    varGrupos   = variacao(atual.clientesGruposOferta, anterior.clientesGruposOferta);
    varVendas   = variacao(atual.vendasRealizadas,     anterior.vendasRealizadas);
    varReceita  = variacao(atual.receitaTotal,         anterior.receitaTotal);

    if      (varGoogle < -25) { score += 25; alertas.push(`Google caiu ${Math.abs(varGoogle).toFixed(1)}%`); }
    else if (varGoogle < -10) { score += 12; }

    if      (varFacebook < -25) { score += 20; alertas.push(`Facebook caiu ${Math.abs(varFacebook).toFixed(1)}%`); }
    else if (varFacebook < -10) { score += 10; }

    if      (varGrupos < -25) { score += 15; alertas.push(`Grupos caiu ${Math.abs(varGrupos).toFixed(1)}%`); }
    else if (varGrupos < -10) { score += 7; }

    if      (varVendas < -20) { score += 25; alertas.push(`Vendas cairam ${Math.abs(varVendas).toFixed(1)}%`); }
    else if (varVendas < -10) { score += 12; }

    if      (varReceita < -20) { score += 15; alertas.push(`Receita caiu ${Math.abs(varReceita).toFixed(1)}%`); }
    else if (varReceita < -10) { score += 7; }
  }

  let nivelAlerta: 'verde' | 'amarelo' | 'vermelho' = 'verde';
  if      (score >= 50) nivelAlerta = 'vermelho';
  else if (score >= 20) nivelAlerta = 'amarelo';

  return {
    scoreCriticidade: Math.round(score * 100) / 100,
    nivelAlerta,
    variacaoGoogle:   Math.round(varGoogle   * 100) / 100,
    variacaoFacebook: Math.round(varFacebook * 100) / 100,
    variacaoGrupos:   Math.round(varGrupos   * 100) / 100,
    variacaoVendas:   Math.round(varVendas   * 100) / 100,
    variacaoReceita:  Math.round(varReceita  * 100) / 100,
    alertas,
  };
}
