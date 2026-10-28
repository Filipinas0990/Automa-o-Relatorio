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

/** Farmácia com empresa vinculada no PharmaChatbot (ativa ou não no painel). */
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

// ── Coleta dia a dia (migration 0043) ────────────────────────────────────────

/** Uma empresa, um dia, uma origem — como sai da consulta agrupada por DATE(created_at). */
export interface LinhaDiaria {
  tenant:       string;
  company_id:   number;
  /** "AAAA-MM-DD" */
  dia:          string;
  origem:       string;
  atendimentos: number;
  vendas:       number;
  receita:      number;
}

/**
 * Arquivo da coleta diária. O importador troca TODOS os dias de `inicio` a
 * `fim` das farmácias vinculadas (quem não aparece fica sem movimento nesses
 * dias) — por isso o arquivo nunca pode ser parcial.
 */
export interface ArquivoColetaDiaria {
  inicio:    string;
  fim:       string;
  gerado_em: string;
  linhas:    LinhaDiaria[];
}

/** Dia de uma farmácia já gravado no painel. */
export interface DiaGravado {
  farmaciaId:   number;
  dia:          string;
  origem:       string;
  atendimentos: number;
  vendas:       number;
  receita:      number;
}

/** Guarda e lê a coleta dia a dia. */
export interface RepositorioDiario {
  /** Apaga os dias do intervalo dessas farmácias e grava os novos (numa transação). */
  substituirDias(farmaciaIds: number[], inicio: string, fim: string, dias: DiaGravado[]): Promise<void>;
  /** Dias gravados de `inicio` a `fim`, de todas as farmácias. */
  dias(inicio: string, fim: string): Promise<DiaGravado[]>;
  /** Último dia com algum número gravado (null com a tabela vazia). */
  ultimoDia(): Promise<string | null>;
}

/** Quem recalcula as janelas 7/15/30 de `coletas` a partir de um arquivo agregado. */
export interface ImportadorDeJanelas {
  importar(entrada: unknown): Promise<ResumoImportacao>;
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

export interface ResumoImportacaoDiaria {
  inicio:           string;
  fim:              string;
  dias_gravados:    number;
  farmacias:        number;
  /** Empresas com movimento no arquivo que nenhuma farmácia aponta. */
  sem_vinculo:      EmpresaSemVinculo[];
  /** Vinculadas sem nenhum atendimento no intervalo do arquivo. */
  vinculadas_zeradas: string[];
  /** Janelas 7/15/30 recalculadas, terminando no último dia gravado. */
  janelas:          ResumoImportacao;
}
