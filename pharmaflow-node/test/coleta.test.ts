/**
 * Importação da coleta do PharmaChatbot — regra pura, com dublês no lugar do
 * banco (o serviço depende só de LeitorDeVinculos e GravadorDeColetas).
 */
import { describe, it, expect } from 'vitest';
import { ImportacaoColetaService } from '../src/coleta/ImportacaoColetaService';
import type {
  ArquivoColeta, FarmaciaVinculada, GravadorDeColetas, LeitorDeVinculos,
  LinhaColeta, NovaColeta, NovoCanal,
} from '../src/coleta/contratos';
import { RequisicaoInvalida } from '../src/compartilhado/erros';

const DROGAVAZ: FarmaciaVinculada = {
  id: 1, nome: 'Drogavaz', tenant: 'pharma-11', companyId: 77,
  metaReceita: 6000, metaLeadsGoogle: 10, metaLeadsMeta: null,
};
const SEM_MOVIMENTO: FarmaciaVinculada = {
  id: 2, nome: 'Farmácia Parada', tenant: 'pharma-12', companyId: 77,
  metaReceita: null, metaLeadsGoogle: null, metaLeadsMeta: null,
};

class Dubles implements LeitorDeVinculos, GravadorDeColetas {
  gravadas: { coleta: NovaColeta; canais: NovoCanal[] }[] = [];
  constructor(private readonly lista: FarmaciaVinculada[]) {}
  async farmaciasVinculadas() { return this.lista; }
  async substituir(coleta: NovaColeta, canais: NovoCanal[]) { this.gravadas.push({ coleta, canais }); }
  da(farmaciaId: number, dias: number) {
    return this.gravadas.find((g) => g.coleta.farmaciaId === farmaciaId && g.coleta.periodoDias === dias)!;
  }
}

const linha = (p: Partial<LinhaColeta>): LinhaColeta => ({
  tenant: 'pharma-11', company_id: 77, origem: 'Google', dias: 7, momento: 'atual',
  atendimentos: 0, vendas: 0, receita: 0, ...p,
});

function arquivo(linhas: LinhaColeta[]): ArquivoColeta {
  return { periodo_fim: '2026-10-22', gerado_em: '2026-10-23T09:00:00-03:00', linhas };
}

describe('Importação da coleta', () => {
  it('soma as origens, grava os canais crus e calcula o período terminando em periodo_fim', async () => {
    const d = new Dubles([DROGAVAZ]);
    await new ImportacaoColetaService(d, d).importar(arquivo([
      linha({ origem: 'Google Ads', atendimentos: 8, vendas: 3, receita: 300.5 }),
      linha({ origem: 'google', atendimentos: 4, vendas: 1, receita: 100 }),
      linha({ origem: 'Instagram', atendimentos: 5, vendas: 2, receita: 6000 }),
      linha({ origem: 'Grupo de ofertas', atendimentos: 2, vendas: 0, receita: 0 }),
    ]));

    const { coleta, canais } = d.da(1, 7);
    expect(coleta.periodoInicio).toBe('2026-10-16');
    expect(coleta.periodoFim).toBe('2026-10-22');
    expect(coleta.totalAtendimentos).toBe(19);
    expect(coleta.vendasRealizadas).toBe(6);
    expect(coleta.receitaTotal).toBe(6400.5);
    // Canais padronizados só para o score; na tabela vai a origem como veio
    expect(coleta.clientesGoogle).toBe(12);
    expect(coleta.clientesFacebook).toBe(5);
    expect(coleta.clientesGruposOferta).toBe(2);
    expect(canais.map((c) => c.canal).sort()).toEqual(['Google Ads', 'Grupo de ofertas', 'Instagram', 'google']);
    expect(coleta.atingiuMeta).toBe(true);
    expect(coleta.atingiuMetaGoogle).toBe(true);   // 12 ≥ 10 na semana
    expect(coleta.atingiuMetaMeta).toBeNull();     // sem meta de leads Meta
  });

  it('compara com o período anterior: queda forte de vendas e receita vira alerta', async () => {
    const d = new Dubles([DROGAVAZ]);
    await new ImportacaoColetaService(d, d).importar(arquivo([
      linha({ momento: 'atual',    atendimentos: 10, vendas: 2,  receita: 200 }),
      linha({ momento: 'anterior', atendimentos: 40, vendas: 20, receita: 2000 }),
    ]));
    const { coleta } = d.da(1, 7);
    expect(coleta.variacaoVendas).toBe(-90);
    expect(coleta.variacaoReceita).toBe(-90);
    expect(coleta.variacaoGoogle).toBe(-75);
    expect(coleta.nivelAlerta).toBe('vermelho');
  });

  it('meta de leads semanal vale proporcional na janela de 30 dias', async () => {
    const d = new Dubles([DROGAVAZ]);
    await new ImportacaoColetaService(d, d).importar(arquivo([
      linha({ dias: 30, atendimentos: 20 }),   // precisaria de 10 × 30/7 ≈ 42,9
    ]));
    expect(d.da(1, 30).coleta.atingiuMetaGoogle).toBe(false);
  });

  it('o mesmo company_id em outro tenant é outra empresa', async () => {
    const d = new Dubles([DROGAVAZ, SEM_MOVIMENTO]);
    const r = await new ImportacaoColetaService(d, d).importar(arquivo([
      linha({ atendimentos: 5 }),
    ]));
    expect(d.da(2, 7).coleta.totalAtendimentos).toBe(0);
    expect(r.vinculadas_zeradas).toEqual(['Farmácia Parada']);
    expect(r.coletas_gravadas).toBe(6); // 2 farmácias × 3 janelas
  });

  it('lista as empresas com movimento que ninguém vinculou', async () => {
    const d = new Dubles([DROGAVAZ]);
    const r = await new ImportacaoColetaService(d, d).importar(arquivo([
      linha({ tenant: 'cyborg', company_id: 5, dias: 30, atendimentos: 3 }),
      linha({ tenant: 'cyborg', company_id: 5, dias: 30, origem: 'Meta', atendimentos: 4 }),
      linha({ tenant: 'cyborg', company_id: 5, dias: 7, atendimentos: 99 }), // só a janela de 30 conta
    ]));
    expect(r.sem_vinculo).toEqual([{ tenant: 'cyborg', company_id: 5, atendimentos: 7 }]);
  });

  it('recusa arquivo fora do formato antes de gravar qualquer coisa', async () => {
    const d = new Dubles([DROGAVAZ]);
    const s = new ImportacaoColetaService(d, d);
    await expect(s.importar({ periodo_fim: '22/10/2026', linhas: [] })).rejects.toBeInstanceOf(RequisicaoInvalida);
    await expect(s.importar(arquivo([linha({ dias: 10 as 7 })]))).rejects.toThrow(/Linha 1/);
    await expect(s.importar(arquivo([linha({ receita: -1 })]))).rejects.toThrow(/Linha 1/);
    expect(d.gravadas).toHaveLength(0);
  });
});
