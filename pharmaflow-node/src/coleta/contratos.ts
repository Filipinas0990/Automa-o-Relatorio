// Contratos da coleta de desempenho (atendimentos, vendas, receita, canais).
//
// A fonte é o banco de produção do PharmaChatbot (MCP engine-prod, só
// leitura). Enquanto não há credencial de serviço, a consulta roda com o login
// pessoal do dono numa sessão do Claude Code, que gera um ArquivoColeta; o
// backend só importa o arquivo. Quando vier a credencial, outra fonte gera o
// mesmo ArquivoColeta e o ImportacaoColetaService não muda.

import type { Janela } from '../custo/calculo';

/** Janela do período pedido ou do período imediatamente anterior (para a variação). */
export type Momento = 'atual' | 'anterior';

/**
 * Uma linha agregada do engine-prod: tickets de uma empresa, numa origem,
 * numa janela. Sem dado pessoal — só contagens e soma.
 */
export interface LinhaColeta {
  tenant:       string;
  company_id:   number;
  /** `tickets.origin` cru ("(sem origem)" quando nulo). */
  origem:       string;
  dias:         Janela;
  momento:      Momento;
  atendimentos: number;
  vendas:       number;
  receita:      number;
}

export interface ArquivoColeta {
  /** Último dia do período (ontem, em Brasília), "AAAA-MM-DD". */
  periodo_fim: string;
  gerado_em:   string;
  linhas:      LinhaColeta[];
}

/** Farmácia ativa com empresa vinculada no PharmaChatbot. */
export interface FarmaciaVinculada {
  id:              number;
  nome:            string;
  tenant:          string;
  companyId:       number;
  metaReceita:     number | null;
  metaLeadsGoogle: number | null;
  metaLeadsMeta:   number | null;
}

export interface NovaColeta {
  farmaciaId:           number;
  periodoInicio:        string;
  periodoFim:           string;
  periodoDias:          Janela;
  clientesGoogle:       number;
  clientesFacebook:     number;
  clientesGruposOferta: number;
  totalAtendimentos:    number;
  vendasRealizadas:     number;
  receitaTotal:         number;
  variacaoGoogle:       number;
  variacaoFacebook:     number;
  variacaoGrupos:       number;
  variacaoVendas:       number;
  variacaoReceita:      number;
  scoreCriticidade:     number;
  nivelAlerta:          'verde' | 'amarelo' | 'vermelho';
  atingiuMeta:          boolean;
  atingiuMetaGoogle:    boolean | null;
  atingiuMetaMeta:      boolean | null;
}

export interface NovoCanal {
  canal:         string;
  atendimentos:  number;
  vendas:        number;
  receitaVendas: number;
}

/** Quem a importação precisa consultar: as farmácias vinculadas. */
export interface LeitorDeVinculos {
  farmaciasVinculadas(): Promise<FarmaciaVinculada[]>;
}

/** Quem grava: troca a coleta da farmácia naquele período (rodar duas vezes não duplica). */
export interface GravadorDeColetas {
  substituir(coleta: NovaColeta, canais: NovoCanal[]): Promise<void>;
}

export interface EmpresaSemVinculo {
  tenant:       string;
  company_id:   number;
  atendimentos: number;
}

export interface ResumoImportacao {
  periodo_fim:       string;
  farmacias:         number;
  coletas_gravadas:  number;
  /** Empresas com movimento no arquivo que nenhuma farmácia aponta — candidatas a vincular. */
  sem_vinculo:       EmpresaSemVinculo[];
  /** Farmácias vinculadas que não tiveram nenhum ticket (gravadas zeradas). */
  vinculadas_zeradas: string[];
}
