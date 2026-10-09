// Tipos da regra de score (processor/score.ts)

export interface Metricas {
  clientesGoogle:       number;
  clientesFacebook:     number;
  clientesGruposOferta: number;
  vendasRealizadas:     number;
  receitaTotal:         number;
}

export interface ScoreInfo {
  scoreCriticidade: number;
  nivelAlerta:      'verde' | 'amarelo' | 'vermelho';
  variacaoGoogle:   number;
  variacaoFacebook: number;
  variacaoGrupos:   number;
  variacaoVendas:   number;
  variacaoReceita:  number;
  alertas:          string[];
}
