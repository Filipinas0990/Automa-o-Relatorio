/**
 * Importação da coleta dia a dia — regra pura, com dublês no lugar do banco
 * (o serviço depende só de LeitorDeVinculos, RepositorioDiario e
 * ImportadorDeJanelas).
 */
import { describe, it, expect } from 'vitest';
import { ImportacaoDiariaService, ehArquivoDiario } from '../src/coleta/ImportacaoDiariaService';
import type {
  ArquivoColeta, ArquivoColetaDiaria, DiaGravado, FarmaciaVinculada, ImportadorDeJanelas,
  LeitorDeVinculos, LinhaDiaria, RepositorioDiario, ResumoImportacao,
} from '../src/coleta/contratos';
import { RequisicaoInvalida } from '../src/compartilhado/erros';

const DROGAVAZ: FarmaciaVinculada = {
  id: 1, nome: 'Drogavaz', tenant: 'pharma-11', companyId: 77,
  metaReceita: null, metaLeadsGoogle: null, metaLeadsMeta: null,
};
const PARADA: FarmaciaVinculada = {
  id: 2, nome: 'Farmácia Parada', tenant: 'pharma-12', companyId: 77,
  metaReceita: null, metaLeadsGoogle: null, metaLeadsMeta: null,
};

/** Banco em memória: a tabela coleta_diaria vira uma lista. */
class Dubles implements LeitorDeVinculos, RepositorioDiario, ImportadorDeJanelas {
  tabela: DiaGravado[] = [];
  trocas: { farmaciaIds: number[]; inicio: string; fim: string }[] = [];
  janelas: ArquivoColeta[] = [];
  constructor(private readonly lista: FarmaciaVinculada[]) {}

  async farmaciasVinculadas() { return this.lista; }
  async substituirDias(farmaciaIds: number[], inicio: string, fim: string, dias: DiaGravado[]) {
    this.trocas.push({ farmaciaIds, inicio, fim });
    this.tabela = this.tabela.filter((d) => !(farmaciaIds.includes(d.farmaciaId) && d.dia >= inicio && d.dia <= fim));
    this.tabela.push(...dias);
  }
  async dias(inicio: string, fim: string) { return this.tabela.filter((d) => d.dia >= inicio && d.dia <= fim); }
  async ultimoDia() { return this.tabela.reduce<string | null>((m, d) => (!m || d.dia > m ? d.dia : m), null); }
  async importar(entrada: unknown): Promise<ResumoImportacao> {
    const a = entrada as ArquivoColeta;
    this.janelas.push(a);
    return { periodo_fim: a.periodo_fim, farmacias: this.lista.length, coletas_gravadas: 0, sem_vinculo: [], vinculadas_zeradas: [] };
  }
}

const linha = (p: Partial<LinhaDiaria>): LinhaDiaria => ({
  tenant: 'pharma-11', company_id: 77, dia: '2026-10-27', origem: 'Google',
  atendimentos: 0, vendas: 0, receita: 0, ...p,
});

const arquivo = (inicio: string, fim: string, linhas: LinhaDiaria[]): ArquivoColetaDiaria =>
  ({ inicio, fim, gerado_em: '2026-10-28T06:00:00-03:00', linhas });

/** Soma uma métrica das linhas de janela de uma janela/momento. */
const somaJanela = (a: ArquivoColeta, dias: number, momento: string) =>
  a.linhas.filter((l) => l.dias === dias && l.momento === momento).reduce((s, l) => s + l.atendimentos, 0);

describe('Importação da coleta diária', () => {
  it('troca os dias do intervalo de todas as vinculadas e soma origem repetida', async () => {
    const d = new Dubles([DROGAVAZ, PARADA]);
    d.tabela = [
      { farmaciaId: 2, dia: '2026-10-25', origem: 'Meta', atendimentos: 9, vendas: 0, receita: 0 }, // some: dentro do intervalo
      { farmaciaId: 2, dia: '2026-10-10', origem: 'Meta', atendimentos: 4, vendas: 0, receita: 0 }, // fica: fora
    ];
    const r = await new ImportacaoDiariaService(d, d, d).importar(arquivo('2026-10-21', '2026-10-27', [
      linha({ atendimentos: 3, vendas: 1, receita: 10.1 }),
      linha({ atendimentos: 2, vendas: 1, receita: 20.2 }),
      linha({ tenant: 'cyborg', company_id: 5, atendimentos: 8 }),
    ]));

    expect(d.trocas).toEqual([{ farmaciaIds: [1, 2], inicio: '2026-10-21', fim: '2026-10-27' }]);
    expect(d.tabela).toEqual([
      { farmaciaId: 2, dia: '2026-10-10', origem: 'Meta', atendimentos: 4, vendas: 0, receita: 0 },
      { farmaciaId: 1, dia: '2026-10-27', origem: 'Google', atendimentos: 5, vendas: 2, receita: 30.3 },
    ]);
    expect(r.dias_gravados).toBe(1);
    expect(r.vinculadas_zeradas).toEqual(['Farmácia Parada']);
    expect(r.sem_vinculo).toEqual([{ tenant: 'cyborg', company_id: 5, atendimentos: 8 }]);
  });

  it('recalcula as janelas a partir dos dias gravados, separando atual e anterior', async () => {
    const d = new Dubles([DROGAVAZ]);
    d.tabela = [
      { farmaciaId: 1, dia: '2026-10-14', origem: 'Google', atendimentos: 7, vendas: 0, receita: 0 }, // 7d anterior
      { farmaciaId: 1, dia: '2026-10-13', origem: 'Google', atendimentos: 100, vendas: 0, receita: 0 }, // fora do 7d
    ];
    await new ImportacaoDiariaService(d, d, d).importar(arquivo('2026-10-21', '2026-10-27', [
      linha({ dia: '2026-10-21', atendimentos: 2 }),
      linha({ dia: '2026-10-27', atendimentos: 3 }),
    ]));

    const [j] = d.janelas;
    expect(j.periodo_fim).toBe('2026-10-27');
    expect(somaJanela(j, 7, 'atual')).toBe(5);
    expect(somaJanela(j, 7, 'anterior')).toBe(7);
    expect(somaJanela(j, 15, 'atual')).toBe(112);
    expect(somaJanela(j, 30, 'atual')).toBe(112);
  });

  it('carga de um mês antigo não muda o fim das janelas (ranking segue no último dia)', async () => {
    const d = new Dubles([DROGAVAZ]);
    d.tabela = [{ farmaciaId: 1, dia: '2026-10-27', origem: 'Google', atendimentos: 1, vendas: 0, receita: 0 }];
    await new ImportacaoDiariaService(d, d, d).importar(arquivo('2026-08-01', '2026-08-31', [
      linha({ dia: '2026-08-15', atendimentos: 50 }),
    ]));
    expect(d.janelas[0].periodo_fim).toBe('2026-10-27');
  });

  it('reconhece o formato pelo campo inicio', () => {
    expect(ehArquivoDiario(arquivo('2026-10-21', '2026-10-27', []))).toBe(true);
    expect(ehArquivoDiario({ periodo_fim: '2026-10-27', linhas: [] })).toBe(false);
  });

  it('recusa arquivo fora do formato antes de gravar qualquer coisa', async () => {
    const d = new Dubles([DROGAVAZ]);
    const s = new ImportacaoDiariaService(d, d, d);
    await expect(s.importar({ inicio: '21/10/2026', fim: '2026-10-27', linhas: [] })).rejects.toBeInstanceOf(RequisicaoInvalida);
    await expect(s.importar(arquivo('2026-10-27', '2026-10-21', []))).rejects.toThrow(/inicio depois/);
    await expect(s.importar(arquivo('2026-06-01', '2026-10-27', []))).rejects.toThrow(/100 dias/);
    await expect(s.importar(arquivo('2026-10-21', '2026-10-27', [linha({ dia: '2026-10-20' })]))).rejects.toThrow(/Linha 1/);
    await expect(s.importar(arquivo('2026-10-21', '2026-10-27', [linha({ vendas: -1 })]))).rejects.toThrow(/Linha 1/);
    expect(d.trocas).toHaveLength(0);
  });
});
