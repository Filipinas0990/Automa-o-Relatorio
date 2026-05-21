// Interfaces compartilhadas por scraper, pipeline e API

export interface CanalVenda {
  vendas:  number;
  receita: number;
}

export interface DadosFarmacia {
  nome:                 string;
  periodoInicio:        string;
  periodoFim:           string;
  clientesGoogle:       number;
  clientesFacebook:     number;
  clientesGruposOferta: number;
  totalAtendimentos:    number;
  vendasRealizadas:     number;
  receitaTotal:         number;
  canais:               Record<string, number>;
  canaisVendas:         Record<string, CanalVenda>;
  erro:                 string | null;
}

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

export interface FarmaciaParaColeta {
  id:              number;
  nome:            string;
  urlBase:         string;
  email:           string;
  senha:           string;
  metaLeadsGoogle: number | null;
  metaLeadsMeta:   number | null;
}
