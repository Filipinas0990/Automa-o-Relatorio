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
 */
export function fatiarRodizio(
  midias:   MidiaDisparo[],
  cursor:   number,
  porEnvio: number = PRODUTOS_POR_ENVIO,
  daVolta:  boolean = false,
): { lote: MidiaDisparo[]; proximoCursor: number; acabou: boolean } {
  if (midias.length === 0) return { lote: [], proximoCursor: 0, acabou: true };

  // Tolera cursor sujo (negativo, ou além do fim se o disparo foi editado)
  const bruto  = Math.min(Math.max(0, Math.trunc(cursor)), midias.length);
  // Cursor parado no fim + volta = recomeça a lista nesta mesma postagem
  const inicio = daVolta && bruto >= midias.length ? 0 : bruto;
  const lote   = midias.slice(inicio, inicio + porEnvio);

  const fimDaLista    = inicio + lote.length >= midias.length;
  const proximoCursor = daVolta && fimDaLista ? 0 : inicio + lote.length;

  return { lote, proximoCursor, acabou: daVolta ? false : fimDaLista };
}

/**
 * Aplica o rodízio quando o disparo se repete. No envio único a lista vai
 * inteira: só existe uma ocorrência, então fatiar deixaria a maior parte dos
 * produtos que o cliente pediu sem sair nunca.
 */
export function loteDaVez(
  disparo: DisparoGrupo,
  midias:  MidiaDisparo[],
): { lote: MidiaDisparo[]; proximoCursor: number; acabou: boolean } {
  if (disparo.repetir === 'nunca') {
    return { lote: midias, proximoCursor: midias.length, acabou: true };
  }
  return fatiarRodizio(midias, disparo.cursorMidia ?? 0, PRODUTOS_POR_ENVIO, disparo.repetirProdutos);
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
  return (disparo.cursorMidia ?? 0) >= total;
}
