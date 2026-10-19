// Vínculo conta de anúncios → farmácia, pelo nome. Regra pura (sem banco e sem
// rede), para poder ser testada direto.
//
// O sistema não guarda qual conta é de qual farmácia: o wizard escolhe a conta
// direto do token do gestor. Mas as contas seguem o padrão
// "CA01 - [RAZÃO SOCIAL - NOME FANTASIA]", e a farmácia tem a razão social
// (nome) e o nome fantasia (nome_fachada) — dá para casar um com o outro.

export interface FarmaciaParaVincular {
  id:          number;
  nome:        string;
  nomeFachada: string | null;
}

export interface ContaParaVincular {
  id:   string;   // "act_123"
  nome: string;
}

/** Palavras que não identificam ninguém: tipo societário, preposição, ramo. */
const IGNORADAS = new Set([
  'LTDA', 'LIMITADA', 'ME', 'EPP', 'EIRELI', 'SA', 'CIA', 'DE', 'DA', 'DO', 'DOS', 'DAS', 'E',
  'COMERCIO', 'PRODUTOS', 'FARMACEUTICOS', 'MEDICAMENTOS', 'COSMETICOS', 'PERFUMARIA',
  'LOJA', 'UNIDADE', 'PROVISORIO',
]);

/**
 * Palavras comuns demais no ramo para identificar uma farmácia sozinhas. Não
 * contam como prova: "Drogaria Mais Saúde" não pode casar com toda conta que
 * tenha "MAIS" e "SAUDE".
 */
const GENERICAS = new Set([
  'FARMACIA', 'FARMACIAS', 'DROGARIA', 'DROGARIAS', 'FARMA', 'DRUGSTORE', 'DROGA',
  'POPULAR', 'SAUDE', 'ATACADAO', 'MAIS', 'DIA', 'NOVA', 'SANTA', 'SAO', 'BEM', 'VIDA',
  'ESTAR', 'BRASIL', 'PELA', 'ULTRA', 'MAX', 'SUPER', 'CENTRAL', 'PRECO', 'BAIXO',
]);

function palavras(texto: string): string[] {
  return texto
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .split(' ')
    .filter((p) => p.length > 1 && !/^\d+$/.test(p) && !IGNORADAS.has(p));
}

/** Tira o prefixo "CA01 -", "[CA-O1] -", "CA 02-" do nome da conta. */
function semPrefixo(nomeConta: string): string {
  return nomeConta.replace(/^\s*\[?\s*CA\s*-?\s*[O0]?\d*\s*\]?\s*-?\s*/i, '');
}

/** Palavras que identificam a farmácia, por nome (razão social e fantasia). */
function chavesDa(f: FarmaciaParaVincular): string[][] {
  return [f.nome, f.nomeFachada ?? '']
    .map((n) => palavras(n).filter((p) => !GENERICAS.has(p)))
    .filter((chave) => chave.length > 0);
}

/**
 * Quantas palavras da farmácia aparecem na conta — 0 se alguma chave não
 * aparece inteira. Ex.: "SAO JUDAS TADEU DE FRUTAL" só casa com conta que tenha
 * JUDAS, TADEU e FRUTAL.
 */
function pontos(chaves: string[][], conta: Set<string>): number {
  let melhor = 0;
  for (const chave of chaves) {
    if (chave.every((p) => conta.has(p))) melhor = Math.max(melhor, chave.length);
  }
  return melhor;
}

export interface ResultadoVinculo {
  /** farmaciaId → contas dela (uma farmácia pode ter CA01 e CA02). */
  porFarmacia: Map<number, string[]>;
  /** Contas que não casaram com nenhuma farmácia, ou que casaram com duas empatadas. */
  semFarmacia: ContaParaVincular[];
}

/**
 * Casa cada conta com a farmácia de maior pontuação. Empate entre farmácias
 * diferentes = ambíguo, a conta fica de fora (melhor não mostrar do que mostrar
 * o gasto de uma farmácia na linha de outra).
 */
export function vincularContas(contas: ContaParaVincular[], farmacias: FarmaciaParaVincular[]): ResultadoVinculo {
  const chaves = farmacias.map((f) => ({ id: f.id, chaves: chavesDa(f) }));
  const porFarmacia = new Map<number, string[]>();
  const semFarmacia: ContaParaVincular[] = [];

  for (const conta of contas) {
    const daConta = new Set(palavras(semPrefixo(conta.nome)));
    let melhor = 0;
    let vencedoras: number[] = [];

    for (const f of chaves) {
      const p = pontos(f.chaves, daConta);
      if (p === 0) continue;
      if (p > melhor) { melhor = p; vencedoras = [f.id]; }
      else if (p === melhor) vencedoras.push(f.id);
    }

    if (vencedoras.length !== 1) { semFarmacia.push(conta); continue; }
    const id = vencedoras[0];
    porFarmacia.set(id, [...(porFarmacia.get(id) ?? []), conta.id]);
  }

  return { porFarmacia, semFarmacia };
}
