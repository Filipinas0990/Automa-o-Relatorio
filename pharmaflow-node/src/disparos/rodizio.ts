import type { DisparoGrupo } from '../database/schema';
import type { MidiaDisparo } from './types';

/**
 * Quantos produtos saem em CADA postagem de um disparo repetido.
 *
 * Número do dono (09/09/2026), de propósito sem campo na tela: é regra do
 * sistema, não configuração por campanha. Mexer aqui muda todos os disparos
 * repetidos a partir do próximo envio.
 */
export const PRODUTOS_POR_ENVIO = 3;

/**
 * Escolhe o lote de criativos desta postagem e diz onde a próxima começa.
 *
 * Sequencial na ordem em que o gestor montou (não sorteia): sorteio
 * independente repetiria produto e deixaria outro sem sair nenhuma vez — e
 * ninguém consegue auditar no histórico o que já foi.
 *
 * Por padrão a lista NÃO dá a volta: acabaram os produtos, acabou a campanha.
 * Por isso o último lote pode sair curto — 20 produtos de 3 em 3 terminam com
 * uma postagem de 2, e não com duas artes repetidas do começo.
 *
 * `daVolta` (toggle "Repetir os produtos", migration 0035) inverte isso: ao
 * alcançar o fim o cursor volta para zero e a campanha continua, porque nesse
 * modo a ÚNICA coisa que a encerra é a data de término. O lote curto do fim
 * continua saindo curto de propósito: emendar o começo da lista dentro da mesma
 * postagem faria um produto aparecer duas vezes com poucos dias de diferença.
 *
 * `acabou` é o que encerra o disparo; sem isso ele continuaria agendado até a
 * data de término, postando lote vazio. Lista vazia acaba sempre — nem o
 * `daVolta` segura, senão a campanha ficaria eternamente postando nada.
 *
 * PAUSA (migration 0047). Produto pausado não entra no lote. Quando a vez
 * dele chega e ele está pausado, o cursor passa por cima e ele é anotado em
 * `puladas` — fica "devendo". Reativado, sai na postagem seguinte, antes da
 * fila normal: estoque que voltou não espera a lista inteira dar a volta.
 * Sem a anotação, o cursor (que só anda para a frente) o deixaria para trás
 * para sempre numa campanha sem volta.
 *
 * Por isso, sem volta, a lista só ACABA quando o cursor chega ao fim e não
 * sobrou ninguém devendo. Se sobrou só produto pausado, a campanha fica
 * esperando — postagem vazia, nada sai — até o gestor reativar ou cancelar:
 * produto pausado não foi ao ar, então a lista não acabou.
 */
export function fatiarRodizio(
  midias:   MidiaDisparo[],
  cursor:   number,
  porEnvio: number = PRODUTOS_POR_ENVIO,
  daVolta:  boolean = false,
  pausa:    EstadoPausa = SEM_PAUSA,
): ResultadoRodizio {
  const total = midias.length;
  if (total === 0) return { lote: [], proximoCursor: 0, acabou: true, puladas: [] };

  const pausadas = new Set(indicesValidos(pausa.pausadas, total));

  // Tolera cursor sujo (negativo, ou além do fim se o disparo foi editado)
  const bruto = Math.min(Math.max(0, Math.trunc(cursor)), total);

  // Cursor parado no fim + volta = recomeça a lista nesta mesma postagem. Na
  // volta nova ninguém está devendo: cada produto ganha a vez dele de novo.
  const novaVolta = daVolta && bruto >= total;
  const inicio    = novaVolta ? 0 : bruto;
  // Só quem já ficou para trás conta como devendo; índice à frente do cursor
  // ainda vai ter a vez dele (e contá-lo duas vezes duplicaria a arte).
  const devendo   = novaVolta ? [] : indicesValidos(pausa.puladas, total).filter((i) => i < inicio);

  const passada = umaPassada(inicio, devendo, pausadas, total, porEnvio);
  const fimDaLista = passada.parouEm >= total;

  if (!daVolta) {
    return {
      lote:          passada.indices.map((i) => midias[i]),
      proximoCursor: passada.parouEm,
      acabou:        fimDaLista && passada.devendo.length === 0,
      puladas:       passada.devendo,
    };
  }

  if (!fimDaLista) {
    return {
      lote:          passada.indices.map((i) => midias[i]),
      proximoCursor: passada.parouEm,
      acabou:        false,
      puladas:       passada.devendo,
    };
  }

  // Fechou a volta. Se o fim da lista estava todo pausado, esta postagem
  // sairia vazia com produto ativo no começo da lista — então já começa a
  // volta nova aqui. Se nem assim sai nada, está tudo pausado.
  if (passada.indices.length === 0) {
    const nova = umaPassada(0, [], pausadas, total, porEnvio);
    const fechouDeNovo = nova.parouEm >= total;
    return {
      lote:          nova.indices.map((i) => midias[i]),
      proximoCursor: fechouDeNovo ? 0 : nova.parouEm,
      acabou:        false,
      puladas:       fechouDeNovo ? [] : nova.devendo,
    };
  }

  return {
    lote:          passada.indices.map((i) => midias[i]),
    proximoCursor: 0,
    acabou:        false,
    puladas:       [],
  };
}

/**
 * Uma passada pela lista: primeiro quem está devendo e já foi reativado, depois
 * a fila normal a partir do cursor, até encher o lote. Pausado que estiver no
 * caminho fica devendo. Devolve os índices escolhidos, em ordem crescente.
 */
function umaPassada(
  inicio:   number,
  devendo:  number[],
  pausadas: Set<number>,
  total:    number,
  porEnvio: number,
): { indices: number[]; parouEm: number; devendo: number[] } {
  const indices: number[] = [];
  const aindaDevendo: number[] = [];

  for (const i of devendo) {
    if (indices.length < porEnvio && !pausadas.has(i)) indices.push(i);
    else aindaDevendo.push(i);
  }

  let pos = inicio;
  while (pos < total && indices.length < porEnvio) {
    if (pausadas.has(pos)) aindaDevendo.push(pos);
    else indices.push(pos);
    pos += 1;
  }

  return { indices, parouEm: pos, devendo: aindaDevendo };
}

/** Inteiros dentro da lista, sem repetição, em ordem — tolera coluna suja. */
function indicesValidos(lista: readonly number[] | null | undefined, total: number): number[] {
  if (!Array.isArray(lista)) return [];
  return [...new Set(lista.filter((i) => Number.isInteger(i) && i >= 0 && i < total))].sort((a, b) => a - b);
}

/** O que o gestor pausou e o que perdeu a vez — colunas da migration 0047. */
export interface EstadoPausa {
  pausadas: readonly number[];
  puladas:  readonly number[];
}

export const SEM_PAUSA: EstadoPausa = { pausadas: [], puladas: [] };

export interface ResultadoRodizio {
  lote:          MidiaDisparo[];
  proximoCursor: number;
  acabou:        boolean;
  /** Novo valor de midias_puladas: quem ficou devendo depois desta postagem. */
  puladas:       number[];
}

/**
 * Aplica o rodízio quando o disparo se repete. No envio único a lista vai
 * inteira: só existe uma ocorrência, então fatiar deixaria a maior parte dos
 * produtos que o cliente pediu sem sair nunca.
 *
 * No envio único o produto pausado simplesmente fica de fora — e é anotado em
 * `puladas` para o acompanhamento mostrar que ele NÃO saiu.
 */
export function loteDaVez(disparo: DisparoGrupo, midias: MidiaDisparo[]): ResultadoRodizio {
  const pausa: EstadoPausa = {
    pausadas: disparo.midiasPausadas ?? [],
    puladas:  disparo.midiasPuladas ?? [],
  };

  if (disparo.repetir === 'nunca') {
    const pausadas = new Set(indicesValidos(pausa.pausadas, midias.length));
    return {
      lote:          midias.filter((_, i) => !pausadas.has(i)),
      proximoCursor: midias.length,
      acabou:        true,
      puladas:       [...pausadas],
    };
  }
  return fatiarRodizio(midias, disparo.cursorMidia ?? 0, PRODUTOS_POR_ENVIO, disparo.repetirProdutos, pausa);
}

/**
 * Monta o que vai para o grupo. Havendo criativo, a mensagem NÃO sai como um
 * balão de texto solto antes das imagens: ela vira a legenda de CADA imagem (a
 * descrição que o WhatsApp mostra embaixo da foto), com o rótulo do produto
 * logo abaixo. Sem criativo, segue como texto puro.
 *
 * Já foi só na primeira imagem, para não repetir o cabeçalho. Não funciona: no
 * WhatsApp cada foto é uma mensagem que pode ser encaminhada, salva e lida
 * sozinha — quem abre a segunda oferta não vê legenda nenhuma, e a foto chega
 * sem dizer de que farmácia é nem até quando vale. Repetir é o certo aqui.
 */
export function montarEnvio(
  mensagem: string,
  midias: MidiaDisparo[],
): { texto: string; midias: MidiaDisparo[] } {
  const texto = (mensagem ?? '').trim();
  if (!texto || midias.length === 0) return { texto, midias };

  return {
    texto:  '',
    midias: midias.map((midia) => {
      const rotulo = midia.rotulo?.trim();
      return { ...midia, rotulo: rotulo ? `${texto}\n\n${rotulo}` : texto };
    }),
  };
}

/**
 * A lista deste disparo já foi inteira para o grupo?
 *
 * Lê o cursor JÁ GRAVADO no banco — serve para o callback do motor de
 * campanhas, que finaliza o disparo num request separado e não tem em mãos o
 * lote que foi enviado.
 */
export function listaAcabou(disparo: DisparoGrupo): boolean {
  // Com "repetir os produtos" a lista nunca acaba: quem encerra é a data de
  // término, e ela é aplicada por calcularProximoEnvio.
  if (disparo.repetirProdutos) return false;

  let total = 0;
  try {
    total = disparo.midiasJson ? (JSON.parse(disparo.midiasJson) as unknown[]).length : 0;
  } catch {
    total = 0;
  }
  // Sem criativo é disparo só de texto: não há lista para acabar
  if (total === 0) return false;

  // Produto que perdeu a vez pausado ainda deve sair (ver fatiarRodizio). No
  // envio único não há "depois": o que ficou de fora, ficou.
  const devendo = disparo.repetir === 'nunca'
    ? 0
    : indicesValidos(disparo.midiasPuladas, total).length;

  return (disparo.cursorMidia ?? 0) >= total && devendo === 0;
}
