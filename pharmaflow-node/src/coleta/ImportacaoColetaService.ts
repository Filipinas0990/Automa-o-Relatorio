import { calcularScore } from '../processor/score';
import { AgregadorCanais } from '../farmacias/AgregadorCanais';
import { JANELAS, somarDias, type Janela } from '../custo/calculo';
import { RequisicaoInvalida } from '../compartilhado/erros';
import type { Metricas } from '../types';
import type {
  ArquivoColeta, EmpresaSemVinculo, FarmaciaVinculada, GravadorDeColetas,
  LeitorDeVinculos, LinhaColeta, NovoCanal, ResumoImportacao,
} from './contratos';

const chave = (tenant: string, companyId: number) => `${tenant}#${companyId}`;
const arredondar = (n: number) => Math.round(n * 100) / 100;

/** Totais de uma origem numa janela. */
interface Totais { atendimentos: number; vendas: number; receita: number }

/**
 * Transforma o arquivo agregado do engine-prod em coletas do painel: para
 * cada farmácia vinculada e cada janela (7, 15, 30 dias), grava os números do
 * período, os canais e o score de criticidade (comparando com o período
 * anterior de mesmo tamanho).
 */
export class ImportacaoColetaService {
  constructor(
    private readonly vinculos: LeitorDeVinculos,
    private readonly gravador: GravadorDeColetas,
  ) {}

  async importar(entrada: unknown): Promise<ResumoImportacao> {
    const arquivo = validarArquivo(entrada);
    const farmacias = await this.vinculos.farmaciasVinculadas();
    const porEmpresa = new Map(farmacias.map((f) => [chave(f.tenant, f.companyId), f]));

    const linhasDa = new Map<number, LinhaColeta[]>();
    const semVinculo = new Map<string, EmpresaSemVinculo>();
    for (const l of arquivo.linhas) {
      const farmacia = porEmpresa.get(chave(l.tenant, l.company_id));
      if (farmacia) {
        linhasDa.set(farmacia.id, [...(linhasDa.get(farmacia.id) ?? []), l]);
      } else if (l.dias === 30 && l.momento === 'atual') {
        const k = chave(l.tenant, l.company_id);
        const s = semVinculo.get(k) ?? { tenant: l.tenant, company_id: l.company_id, atendimentos: 0 };
        s.atendimentos += l.atendimentos;
        semVinculo.set(k, s);
      }
    }

    let gravadas = 0;
    const zeradas: string[] = [];
    for (const farmacia of farmacias) {
      const linhas = linhasDa.get(farmacia.id) ?? [];
      if (linhas.length === 0) zeradas.push(farmacia.nome);
      for (const dias of JANELAS) {
        await this.gravarJanela(farmacia, dias, arquivo.periodo_fim, linhas.filter((l) => l.dias === dias));
        gravadas++;
      }
    }

    return {
      periodo_fim: arquivo.periodo_fim,
      farmacias: farmacias.length,
      coletas_gravadas: gravadas,
      sem_vinculo: [...semVinculo.values()].sort((a, b) => b.atendimentos - a.atendimentos),
      vinculadas_zeradas: zeradas,
    };
  }

  private async gravarJanela(farmacia: FarmaciaVinculada, dias: Janela, fim: string, linhas: LinhaColeta[]) {
    const atual = porOrigem(linhas.filter((l) => l.momento === 'atual'));
    const anterior = porOrigem(linhas.filter((l) => l.momento === 'anterior'));
    const mAtual = metricas(atual);
    const temAnterior = linhas.some((l) => l.momento === 'anterior');
    const score = calcularScore(mAtual, temAnterior ? metricas(anterior) : null);
    const total = somar([...atual.values()]);

    // Metas de leads são semanais: na janela de 15/30 dias vale a proporção.
    const metaLeads = (meta: number | null, feito: number) =>
      meta == null ? null : feito >= meta * (dias / 7);

    const canais: NovoCanal[] = [...atual.entries()].map(([canal, t]) => ({
      canal, atendimentos: t.atendimentos, vendas: t.vendas, receitaVendas: arredondar(t.receita),
    }));

    await this.gravador.substituir({
      farmaciaId:           farmacia.id,
      periodoInicio:        somarDias(fim, -(dias - 1)),
      periodoFim:           fim,
      periodoDias:          dias,
      clientesGoogle:       mAtual.clientesGoogle,
      clientesFacebook:     mAtual.clientesFacebook,
      clientesGruposOferta: mAtual.clientesGruposOferta,
      totalAtendimentos:    total.atendimentos,
      vendasRealizadas:     total.vendas,
      receitaTotal:         arredondar(total.receita),
      variacaoGoogle:       score.variacaoGoogle,
      variacaoFacebook:     score.variacaoFacebook,
      variacaoGrupos:       score.variacaoGrupos,
      variacaoVendas:       score.variacaoVendas,
      variacaoReceita:      score.variacaoReceita,
      scoreCriticidade:     score.scoreCriticidade,
      nivelAlerta:          score.nivelAlerta,
      atingiuMeta:          farmacia.metaReceita != null && total.receita >= farmacia.metaReceita,
      atingiuMetaGoogle:    metaLeads(farmacia.metaLeadsGoogle, mAtual.clientesGoogle),
      atingiuMetaMeta:      metaLeads(farmacia.metaLeadsMeta, mAtual.clientesFacebook),
    }, canais);
  }
}

/** Soma as linhas por origem crua (o arquivo pode repetir origem em páginas diferentes). */
function porOrigem(linhas: LinhaColeta[]): Map<string, Totais> {
  const m = new Map<string, Totais>();
  for (const l of linhas) {
    const t = m.get(l.origem) ?? { atendimentos: 0, vendas: 0, receita: 0 };
    t.atendimentos += l.atendimentos;
    t.vendas += l.vendas;
    t.receita += l.receita;
    m.set(l.origem, t);
  }
  return m;
}

function somar(lista: Totais[]): Totais {
  return lista.reduce((s, t) => ({
    atendimentos: s.atendimentos + t.atendimentos, vendas: s.vendas + t.vendas, receita: s.receita + t.receita,
  }), { atendimentos: 0, vendas: 0, receita: 0 });
}

/** Entradas do score: atendimentos por canal padronizado (Google, Meta, Grupos) + totais. */
function metricas(origens: Map<string, Totais>): Metricas {
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

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const numero = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** Confere o formato do arquivo antes de gravar qualquer coisa. */
export function validarArquivo(entrada: unknown): ArquivoColeta {
  const a = entrada as Partial<ArquivoColeta> | null;
  if (!a || typeof a !== 'object') throw new RequisicaoInvalida('Arquivo de coleta vazio ou inválido');
  if (typeof a.periodo_fim !== 'string' || !DATA.test(a.periodo_fim)) {
    throw new RequisicaoInvalida('periodo_fim precisa ser uma data AAAA-MM-DD');
  }
  if (!Array.isArray(a.linhas)) throw new RequisicaoInvalida('linhas precisa ser uma lista');
  a.linhas.forEach((l, i) => {
    const ok = l && typeof l.tenant === 'string' && l.tenant !== ''
      && Number.isInteger(l.company_id)
      && typeof l.origem === 'string'
      && (JANELAS as readonly number[]).includes(l.dias)
      && (l.momento === 'atual' || l.momento === 'anterior')
      && numero(l.atendimentos) && numero(l.vendas) && numero(l.receita);
    if (!ok) throw new RequisicaoInvalida(`Linha ${i + 1} do arquivo está fora do formato: ${JSON.stringify(l)}`);
  });
  return a as ArquivoColeta;
}
