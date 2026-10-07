// Upload de imagem para a Meta Marketing API e criação do AdCreative

import { metaReq } from './client';
import type { MetaToken } from './types';

interface ImageUploadResult {
  hash: string;
  url:  string;
  name: string;
}

// Faz upload da imagem (base64) para a conta de anúncios do cliente
export async function uploadImagem(
  token:       MetaToken,
  base64Data:  string,
  _nomeArq:    string,
): Promise<ImageUploadResult> {
  // Remove prefixo data URI se houver (ex: data:image/jpeg;base64,...)
  const bytes = base64Data.replace(/^data:image\/\w+;base64,/, '');

  const result = await metaReq<{ images: Record<string, ImageUploadResult> }>(
    'POST',
    `/${token.adAccountId}/adimages`,
    token.accessToken,
    { bytes },
  );

  const keys = Object.keys(result.images ?? {});
  if (!keys.length) throw new Error('Upload de imagem não retornou resultado');
  return result.images[keys[0]];
}

// Cria o AdCreative (combinação de imagem + copy + página)
export async function criarAdCreative(
  token:       MetaToken,
  imagemHash:  string,
  copy:        string,
  linkDestino: string,
  extras?: {
    titulo?:    string;
    descricao?: string;
    /**
     * TODAS as opções de título/descrição do anúncio ("várias opções de texto"
     * do Meta, até 5 de cada): o Meta combina e entrega mais a que performa.
     * Com mais de uma opção elas vão no asset_feed_spec e `titulo`/`descricao`
     * deixam de ir no link_data — formato validado no Meta em 07/10/2026, tanto
     * em conjunto WhatsApp quanto no de vários destinos.
     */
    titulos?:    string[];
    descricoes?: string[];
    whatsapp?:  boolean;
    /**
     * Conjunto de mensagens com vários destinos (Messenger + WhatsApp + Direct,
     * `MESSAGING_INSTAGRAM_DIRECT_MESSENGER_WHATSAPP`). O Meta recusa o ANÚNCIO
     * nesse conjunto se o criativo não trouxer os três botões de mensagem
     * (#2446493, "especificação degrees_of_freedom ausente").
     */
    mensagens?: boolean;
    /**
     * Conta do Instagram que representa a empresa no anúncio. Sem ela, qualquer
     * posicionamento no Instagram é recusado com "selecione uma conta do
     * Instagram para representar sua empresa" (#1772103) — e o anúncio fica
     * criado mas bloqueado no Gerenciador.
     */
    instagramActorId?: string | null;
  },
): Promise<{ id: string }> {
  const link_data: Record<string, unknown> = {
    image_hash: imagemHash,
    link:       linkDestino,
    message:    copy,
  };
  const titulos    = limparOpcoes(extras?.titulos);
  const descricoes = limparOpcoes(extras?.descricoes);
  const variasOpcoes = titulos.length > 1 || descricoes.length > 1;
  // Com várias opções os textos vão todos no asset_feed_spec (mais abaixo).
  if (!variasOpcoes && extras?.titulo)    link_data.name        = extras.titulo;     // headline
  if (!variasOpcoes && extras?.descricao) link_data.description = extras.descricao;

  // Click-to-WhatsApp: link fixo + botão "Enviar mensagem" que abre o WhatsApp
  if (extras?.whatsapp) {
    link_data.link = 'https://api.whatsapp.com/send';
    link_data.call_to_action = {
      type:  'WHATSAPP_MESSAGE',
      value: { app_destination: 'WHATSAPP' },
    };
  }

  const object_story_spec: Record<string, unknown> = {
    page_id: token.pageId,
    link_data,
  };
  // Omitido quando a página não tem Instagram vinculado: mandar o campo vazio
  // faz a Meta recusar o criativo inteiro, e sem ele o anúncio ao menos roda
  // nos posicionamentos do Facebook.
  //
  // O campo é `instagram_user_id`: o Meta aposentou o `instagram_actor_id` e
  // passou a recusá-lo com "must be a valid Instagram account id" mesmo com o
  // id certo (02/10/2026 — os anúncios do Gerenciador já vêm com o novo).
  if (extras?.instagramActorId) {
    object_story_spec.instagram_user_id = extras.instagramActorId;
  }

  // Formato copiado de um anúncio que roda num conjunto desses (criado pelo
  // Gerenciador): link do Messenger + asset_feed_spec com os três destinos, e
  // o Meta escolhe para qual mandar cada pessoa.
  if (extras?.mensagens) {
    link_data.link = 'https://fb.com/messenger_doc/';
    link_data.call_to_action = {
      type:  'MESSAGE_PAGE',
      value: { app_destination: 'MESSENGER' },
    };
  }

  const corpo: Record<string, unknown> = { name: 'Criativo via Automação', object_story_spec };
  if (extras?.mensagens) {
    corpo.asset_feed_spec = {
      optimization_type: 'DOF_MESSAGING_DESTINATION',
      call_to_actions: [
        { type: 'MESSAGE_PAGE',      value: { app_destination: 'MESSENGER',        link: 'https://fb.com/messenger_doc/' } },
        { type: 'WHATSAPP_MESSAGE',  value: { app_destination: 'WHATSAPP',         link: 'https://api.whatsapp.com/send' } },
        { type: 'INSTAGRAM_MESSAGE', value: { app_destination: 'INSTAGRAM_DIRECT', link: 'https://www.instagram.com/' } },
      ],
      additional_data: { multi_share_end_card: false, is_click_to_message: true },
    };
  }

  // Várias opções de texto: entram no asset_feed_spec — junto do de mensagens,
  // quando ele existe, ou num próprio (DEGREES_OF_FREEDOM).
  if (variasOpcoes) {
    const textos: Record<string, unknown> = {};
    if (titulos.length)    textos.titles       = titulos.map((text) => ({ text }));
    if (descricoes.length) textos.descriptions = descricoes.map((text) => ({ text }));
    corpo.asset_feed_spec = corpo.asset_feed_spec
      ? { ...(corpo.asset_feed_spec as Record<string, unknown>), ...textos }
      : { ...textos, optimization_type: 'DEGREES_OF_FREEDOM' };
  }

  // Tenta do opt-out mais completo ao menor: chave que a versão da API ou a
  // conta não conhece volta erro 100 (parâmetro inválido). Sem spec nenhum é o
  // último recurso — e nem sempre serve: conjunto de "múltiplos destinos"
  // recusa o ANÚNCIO de criativo sem degrees_of_freedom_spec (#2446493).
  const tentativas = [RECURSOS_QUE_CORTAM, ['image_touchups', 'image_uncrop'], []];
  for (const [i, recursos] of tentativas.entries()) {
    try {
      return await metaReq<{ id: string }>(
        'POST',
        `/${token.adAccountId}/adcreatives`,
        token.accessToken,
        recursos.length ? { ...corpo, degrees_of_freedom_spec: optOut(recursos) } : corpo,
      );
    } catch (err) {
      const ultima = i === tentativas.length - 1;
      if (ultima || !String((err as Error).message).includes('[100]')) throw err;
      console.warn(`[Meta] opt-out de aprimoramentos recusado (${recursos.join(', ')}), tentando o próximo`);
    }
  }
  throw new Error('inalcançável');
}

/** Tira vazios e repetidos e respeita o teto do Meta (5 opções). */
function limparOpcoes(lista?: string[]): string[] {
  const vistos = new Set<string>();
  const saida: string[] = [];
  for (const bruto of lista ?? []) {
    const t = bruto?.trim();
    if (!t || vistos.has(t)) continue;
    vistos.add(t);
    saida.push(t);
  }
  return saida.slice(0, 5);
}

/** Para onde o clique do anúncio leva — decide o formato do criativo. */
export type DestinoCriativo = 'pagina' | 'whatsapp' | 'mensagens';

/**
 * Lê o destino de um conjunto que já existe no Meta. É a fonte da verdade para
 * anúncios que entram num conjunto (ou numa cópia dele): o front só sabe dizer
 * "é WhatsApp ou não", e conjunto de vários destinos caía no "não" — subia
 * como link para a página e o Meta recusava o anúncio.
 * `null` = destino que não pede formato especial (o chamador decide).
 */
export async function destinoDoConjunto(accessToken: string, conjuntoId: string): Promise<DestinoCriativo | null> {
  const r = await metaReq<{ destination_type?: string }>(
    'GET', `/${conjuntoId}?fields=destination_type`, accessToken,
  );
  const tipo = r.destination_type ?? '';
  if (tipo === 'WHATSAPP') return 'whatsapp';
  // Mais de um canal de mensagem no mesmo conjunto (ex.: MESSAGING_INSTAGRAM_DIRECT_MESSENGER_WHATSAPP).
  const canais = ['MESSENGER', 'WHATSAPP', 'INSTAGRAM_DIRECT'].filter((c) => tipo.includes(c));
  if (tipo.startsWith('MESSAGING_') && canais.length > 1) return 'mensagens';
  return null;
}

/**
 * Aprimoramentos do "Advantage+ criativo" que o Meta liga por conta própria e
 * que mexem no enquadramento da arte: adaptar ao posicionamento (recorta o
 * 4:5 para 9:16 nos stories/reels), expansão de imagem, retoques (recorte
 * automático) e modelos/sobreposições. A arte já sai pronta do app — com
 * título no topo, preço e farmácia nas bordas —, e qualquer recorte do Meta
 * come justamente essas faixas.
 *
 * NÃO incluir `standard_enhancements`: o Meta descontinuou o pacote e recusa o
 * criativo inteiro com ele (#3858504, "defina recursos individuais").
 */
const RECURSOS_QUE_CORTAM = [
  'adapt_to_placement',
  'image_uncrop',
  'image_touchups',
  'image_templates',
  'image_brightness_and_contrast',
];

function optOut(recursos: string[]): Record<string, unknown> {
  return {
    creative_features_spec: Object.fromEntries(
      recursos.map((r) => [r, { enroll_status: 'OPT_OUT' }]),
    ),
  };
}
