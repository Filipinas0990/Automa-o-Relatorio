import { JANELAS, somarDias } from '../custo/calculo';
import { RequisicaoInvalida } from '../compartilhado/erros';
import type {
  ArquivoColeta, ArquivoColetaDiaria, DiaGravado, EmpresaSemVinculo, FarmaciaVinculada,
  ImportadorDeJanelas, LeitorDeVinculos, LinhaColeta, RepositorioDiario, ResumoImportacaoDiaria,
} from './contratos';

const chave = (tenant: string, companyId: number) => `${tenant}#${companyId}`;

/** Maior intervalo aceito num arquivo: a carga inicial é de 90 dias. */
const MAX_DIAS_ARQUIVO = 100;

/**
 * Importa a coleta dia a dia: troca os dias do arquivo em `coleta_diaria` e
 * recalcula as janelas de 7/15/30 dias (`coletas`) terminando no último dia
 * gravado — assim a carga de um mês antigo não toma o lugar do ranking atual.
 */
export class ImportacaoDiariaService {
  constructor(
    private readonly vinculos: LeitorDeVinculos,
    private readonly diario: RepositorioDiario,
    private readonly janelas: ImportadorDeJanelas,
  ) {}

  async importar(entrada: unknown): Promise<ResumoImportacaoDiaria> {
    const arquivo = validarArquivoDiario(entrada);
    const farmacias = await this.vinculos.farmaciasVinculadas();
    const porEmpresa = new Map(farmacias.map((f) => [chave(f.tenant, f.companyId), f]));

    const dias = new Map<string, DiaGravado>();
    const semVinculo = new Map<string, EmpresaSemVinculo>();
    for (const l of arquivo.linhas) {
      const farmacia = porEmpresa.get(chave(l.tenant, l.company_id));
      if (!farmacia) {
        const k = chave(l.tenant, l.company_id);
        const s = semVinculo.get(k) ?? { tenant: l.tenant, company_id: l.company_id, atendimentos: 0 };
        s.atendimentos += l.atendimentos;
        semVinculo.set(k, s);
        continue;
      }
      // A mesma origem pode vir em páginas diferentes da consulta: soma
      const k = `${farmacia.id}#${l.dia}#${l.origem}`;
      const d = dias.get(k) ?? { farmaciaId: farmacia.id, dia: l.dia, origem: l.origem, atendimentos: 0, vendas: 0, receita: 0 };
      d.atendimentos += l.atendimentos;
      d.vendas += l.vendas;
      d.receita = Math.round((d.receita + l.receita) * 100) / 100;
      dias.set(k, d);
    }

    const gravados = [...dias.values()];
    await this.diario.substituirDias(farmacias.map((f) => f.id), arquivo.inicio, arquivo.fim, gravados);

    const comMovimento = new Set(gravados.filter((d) => d.atendimentos > 0).map((d) => d.farmaciaId));
    const ultimo = maiorData(arquivo.fim, await this.diario.ultimoDia());

    return {
      inicio: arquivo.inicio,
      fim: arquivo.fim,
      dias_gravados: gravados.length,
      farmacias: farmacias.length,
      sem_vinculo: [...semVinculo.values()].sort((a, b) => b.atendimentos - a.atendimentos),
      vinculadas_zeradas: farmacias.filter((f) => !comMovimento.has(f.id)).map((f) => f.nome),
      janelas: await this.janelas.importar(await this.arquivoDeJanelas(farmacias, ultimo)),
    };
  }

  /** Monta, a partir dos dias gravados, o arquivo de janelas atual/anterior que termina em `fim`. */
  private async arquivoDeJanelas(farmacias: FarmaciaVinculada[], fim: string): Promise<ArquivoColeta> {
    const maior = Math.max(...JANELAS);
    const porId = new Map(farmacias.map((f) => [f.id, f]));
    const linhas: LinhaColeta[] = [];
    for (const d of await this.diario.dias(somarDias(fim, -(2 * maior - 1)), fim)) {
      const f = porId.get(d.farmaciaId);
      if (!f) continue;
      for (const dias of JANELAS) {
        const momento = d.dia >= somarDias(fim, -(dias - 1)) ? 'atual'
          : d.dia >= somarDias(fim, -(2 * dias - 1)) ? 'anterior' : null;
        if (!momento) continue;
        linhas.push({
          tenant: f.tenant, company_id: f.companyId, origem: d.origem, dias, momento,
          atendimentos: d.atendimentos, vendas: d.vendas, receita: d.receita,
        });
      }
    }
    return { periodo_fim: fim, gerado_em: new Date().toISOString(), linhas };
  }
}

const maiorData = (a: string, b: string | null) => (b && b > a ? b : a);

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const numero = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** Arquivo diário tem `inicio` e linhas com `dia`; o antigo, `periodo_fim` e `dias`. */
export function ehArquivoDiario(entrada: unknown): boolean {
  return !!entrada && typeof entrada === 'object' && 'inicio' in entrada;
}

/** Confere o formato do arquivo diário antes de gravar qualquer coisa. */
export function validarArquivoDiario(entrada: unknown): ArquivoColetaDiaria {
  const a = entrada as Partial<ArquivoColetaDiaria> | null;
  if (!a || typeof a !== 'object') throw new RequisicaoInvalida('Arquivo de coleta vazio ou inválido');
  if (typeof a.inicio !== 'string' || !DATA.test(a.inicio) || typeof a.fim !== 'string' || !DATA.test(a.fim)) {
    throw new RequisicaoInvalida('inicio e fim precisam ser datas AAAA-MM-DD');
  }
  if (a.inicio > a.fim) throw new RequisicaoInvalida('inicio depois do fim');
  if (somarDias(a.inicio, MAX_DIAS_ARQUIVO) <= a.fim) {
    throw new RequisicaoInvalida(`Intervalo maior que ${MAX_DIAS_ARQUIVO} dias`);
  }
  if (!Array.isArray(a.linhas)) throw new RequisicaoInvalida('linhas precisa ser uma lista');
  a.linhas.forEach((l, i) => {
    const ok = l && typeof l.tenant === 'string' && l.tenant !== ''
      && Number.isInteger(l.company_id)
      && typeof l.origem === 'string'
      && typeof l.dia === 'string' && DATA.test(l.dia) && l.dia >= a.inicio! && l.dia <= a.fim!
      && numero(l.atendimentos) && numero(l.vendas) && numero(l.receita);
    if (!ok) throw new RequisicaoInvalida(`Linha ${i + 1} do arquivo está fora do formato: ${JSON.stringify(l)}`);
  });
  return a as ArquivoColetaDiaria;
}
