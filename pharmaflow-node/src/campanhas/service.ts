import { metaReq, ERRO_ANUNCIANTE_VERIFICADO } from '../meta/client';
import { uploadImagem, criarAdCreative, destinoDoConjunto, type DestinoCriativo } from '../meta/criativo';
import { criarCampanhaCompleta, criarAnuncios, dataDeInicioDoAnuncio, proximoNumeroDeAnuncio } from '../meta/campanha';
import { duplicarConjunto, atualizarConjunto, recriarConjunto } from '../meta/gerenciador';
import { gerarCopyPadrao } from './copy-ia';
import { logger } from '../logger';
import type { MetaToken } from '../meta/types';

// ── Tipos do payload que vem do wizard ────────────────────────────────────────

export interface PublicarCampanhaInput {
  /** Token do Meta resolvido pela rota (gestor ou geral). Nunca vem do cliente. */
  accessToken?: string;
  nomeCampanha?: string;   // nome definido pelo gestor no wizard
  conta: {
    id: string;          // "act_..."
    nome?: string;
    cliente?: string;
  };
  /**
   * Página do Facebook escolhida pelo gestor na etapa 1, com o Instagram dela.
   * Antes a página era adivinhada (a primeira do Business Manager), o que num BM
   * com várias farmácias dava "As Páginas não correspondem" (#1885029).
   * Ausente = cai no palpite antigo, para não quebrar chamadas velhas.
   */
  pagina?: { id: string; nome?: string; instagramId?: string | null } | null;
  objetivo: {
    codigo: string;      // OUTCOME_*
    nome?: string;
  };
  publico: {
    genero: 'todos' | 'homens' | 'mulheres';
    idadeMin: number;
    idadeMax: number;
    // null = Brasil inteiro (padrão). Com cidade, exige a "key" do Meta.
    localizacao?: { key: string; nome: string } | null;
    raioKm?: number;
    // undefined/"todas"/"todos" = Advantage+ placements (Meta escolhe sozinho).
    plataforma?: 'todas' | 'instagram' | 'facebook';
    posicionamento?: 'todos' | 'feed' | 'story' | 'feed_story' | 'story_reels';
  };
  orcamento: {
    diarioCentavos: number;
    dataInicio: string;
    dataFim: string | null;
  };
  criativos: {
    itens: Array<{ nome: string; preco?: string | null; pngBase64?: string | null }>;
    copy: { textoPrincipal?: string; titulo?: string; descricao?: string };
  };
}

const GENERO_MAP: Record<string, 'ALL' | 'MALE' | 'FEMALE'> = {
  todos: 'ALL', homens: 'MALE', mulheres: 'FEMALE',
};

/**
 * Descobre a página do Facebook associada à conta de anúncios (necessária para o criativo).
 * Estratégia: business da conta → owned_pages → client_pages → promote_pages.
 * (promote_pages costuma vir vazio; a página real fica no Business Manager da conta.)
 */
async function descobrirPageId(token: MetaToken): Promise<string | null> {
  const buscar = async (path: string): Promise<string | null> => {
    try {
      const res = await metaReq<{ data?: Array<{ id: string }> }>('GET', path, token.accessToken);
      return res.data?.[0]?.id ?? null;
    } catch (e) {
      logger.warn({ err: (e as Error).message, path }, 'Falha ao buscar página');
      return null;
    }
  };

  // 1) Descobre o Business Manager da conta
  let businessId: string | null = null;
  try {
    const res = await metaReq<{ business?: { id: string } }>(
      'GET', `/${token.adAccountId}?fields=business`, token.accessToken,
    );
    businessId = res.business?.id ?? null;
  } catch (e) {
    logger.warn({ err: (e as Error).message }, 'Não consegui obter o business da conta');
  }

  // 2) Páginas do business (owned → client), 3) fallback promote_pages
  if (businessId) {
    const owned = await buscar(`/${businessId}/owned_pages?fields=id,name&limit=1`);
    if (owned) return owned;
    const client = await buscar(`/${businessId}/client_pages?fields=id,name&limit=1`);
    if (client) return client;
  }
  return buscar(`/${token.adAccountId}/promote_pages?fields=id,name&limit=1`);
}

type ItemCriativo = {
  nome: string;
  /** Todas as opções de título/descrição do anúncio (o Meta testa as combinações). */
  titulos?: string[] | null;
  descricoes?: string[] | null;
  textos?: string[] | null;
  /** Nome do anúncio digitado na revisão. Vazio = padrão "AD01 - produto - 2/10". */
  nomeAnuncio?: string | null;
  preco?: string | null;
  pngBase64?: string | null;
  /**
   * Hash da imagem já subida no Meta (por POST /api/campanhas/midias, uma
   * imagem por requisição). Vindo preenchido, o PNG não precisa viajar no corpo
   * desta chamada — é o que mantém a publicação abaixo do teto de ~4,2 MB do
   * proxy da Vercel, que estourava a partir de uns três criativos.
   */
  imagemHash?: string | null;
  // Copy por criativo (copy padrão com {produto}/{preco}/{cidade} já expandidos no front).
  // Se vier vazio, cai na copy da campanha (fallback).
  textoPrincipal?: string | null;
  titulo?: string | null;
  descricao?: string | null;
};
type Copy = { textoPrincipal: string; titulo: string; descricao: string };

/**
 * Sobe cada PNG e cria um AdCreative por imagem. Cada criativo vira depois um
 * anúncio separado no mesmo conjunto, então o Meta rotaciona entre eles e
 * entrega mais o que performa melhor.
 *
 * Falha isolada (imagem rejeitada, upload que caiu) não derruba o resto:
 * registra o aviso e segue com os demais criativos.
 */
async function subirCriativos(
  token:        MetaToken,
  pageId:       string | null,
  itens:        ItemCriativo[],
  copy:         Copy,
  destino:      DestinoCriativo,
  avisos:       string[],
  instagramId?: string | null,
): Promise<Array<{ creativeId: string; rotulo: string; nomeAnuncio?: string | null }>> {
  const criativos: Array<{ creativeId: string; rotulo: string; nomeAnuncio?: string | null }> = [];
  // Serve tanto quem já subiu a imagem antes (hash) quanto quem manda o PNG aqui.
  const comImagem = itens.filter((i) => i.imagemHash || i.pngBase64);

  if (!pageId) {
    avisos.push('Nenhuma página do Facebook encontrada para esta conta — nada foi criado sem anúncio (adicione o criativo manualmente no Ads Manager).');
    return criativos;
  }
  if (!comImagem.length) {
    avisos.push('Nenhum criativo com imagem foi enviado.');
    return criativos;
  }

  const linkDestino = `https://www.facebook.com/${pageId}`;   // usado quando não é WhatsApp
  for (const item of comImagem) {
    try {
      const hash = item.imagemHash
        ? item.imagemHash
        : (await uploadImagem(token, item.pngBase64!, item.nome)).hash;
      // Copy por criativo (copy padrão expandida no front); cai na copy da campanha se vier vazia.
      const textoItem     = item.textoPrincipal?.trim() || copy.textoPrincipal;
      const tituloItem    = item.titulo?.trim()         || copy.titulo;
      const descricaoItem = item.descricao?.trim()      || copy.descricao;
      const creative = await criarAdCreative(token, hash, textoItem, linkDestino, {
        titulo: tituloItem, descricao: descricaoItem,
        titulos: item.titulos ?? undefined, descricoes: item.descricoes ?? undefined,
        textos: item.textos ?? undefined,
        whatsapp: destino === 'whatsapp', mensagens: destino === 'mensagens',
        instagramActorId: instagramId,
      });
      criativos.push({ creativeId: creative.id, rotulo: item.nome, nomeAnuncio: item.nomeAnuncio });
    } catch (e) {
      const msg = (e as Error).message;
      logger.warn({ err: msg, criativo: item.nome }, 'Falha ao subir criativo');
      avisos.push(`Criativo "${item.nome}" não pôde ser enviado: ${msg}`);
    }
  }

  if (!criativos.length) {
    avisos.push('Nenhum criativo pôde ser enviado ao Meta.');
  }
  return criativos;
}

/**
 * Destino dos criativos que vão para um conjunto existente (ou cópia dele,
 * que herda o mesmo destino). Pergunta ao Meta; se a leitura falhar, fica com
 * o que o front informou, que era o comportamento de antes.
 */
async function resolverDestino(
  accessToken:     string,
  conjuntoId:      string,
  destinoWhatsapp: boolean | undefined,
): Promise<DestinoCriativo> {
  try {
    const destino = await destinoDoConjunto(accessToken, conjuntoId);
    if (destino) return destino;
  } catch (e) {
    logger.warn({ err: (e as Error).message, conjuntoId }, 'Não consegui ler o destino do conjunto');
  }
  return destinoWhatsapp ? 'whatsapp' : 'pagina';
}

/**
 * Sem nenhum criativo aceito não há anúncio — e criar a campanha/conjunto assim
 * só deixa lixo vazio no Gerenciador. Interrompe ANTES, com o motivo do Meta
 * (o 1º aviso específico) na mensagem.
 */
function exigirCriativos(criativos: unknown[], avisos: string[], oQue: string): void {
  if (criativos.length) return;
  const motivo = avisos.find((a) => !/^Nenhum (criativo|anúncio)/.test(a)) ?? 'O Meta recusou os criativos.';
  throw new Error(`${oQue} não foi criado, porque nenhum criativo foi aceito pelo Meta. ${motivo} Nada foi publicado.`);
}

/** Monta a copy final: usa a do gestor e completa o que faltar com o template. */
function resolverCopy(
  manual:   { textoPrincipal?: string; titulo?: string; descricao?: string } | undefined,
  produtos: string[],
  farmacia: string | undefined,
): Copy {
  const copy: Copy = {
    textoPrincipal: (manual?.textoPrincipal ?? '').trim(),
    titulo:         (manual?.titulo ?? '').trim(),
    descricao:      (manual?.descricao ?? '').trim(),
  };
  if (copy.textoPrincipal) return copy;

  const padrao = gerarCopyPadrao({ produtos: produtos.filter(Boolean), farmacia });
  return {
    textoPrincipal: padrao.textoPrincipal,
    titulo:         copy.titulo    || padrao.titulo,
    descricao:      copy.descricao || padrao.descricao,
  };
}

/**
 * Publica uma campanha no Meta a partir do payload do wizard.
 * IA só é chamada 1x, e apenas se a copy não veio preenchida.
 * A campanha é criada ATIVA.
 */
export async function publicarCampanha(input: PublicarCampanhaInput): Promise<{
  campanhaId: string;
  conjuntoId: string;
  anuncioId: string;
  anuncioIds: string[];
  linkGerenciador: string;
  copyUsada: { textoPrincipal: string; titulo: string; descricao: string };
  avisos: string[];
}> {
  const avisos: string[] = [];
  const accessToken = input.accessToken ?? process.env.META_ACCESS_TOKEN ?? '';
  if (!accessToken) throw new Error('META_ACCESS_TOKEN não configurado no servidor.');

  const adAccountId = input.conta.id.startsWith('act_') ? input.conta.id : `act_${input.conta.id}`;

  // Página do Facebook: a que o gestor escolheu; só adivinha se não veio.
  const pageId = input.pagina?.id
    ?? await descobrirPageId({ farmaciaId: 0, adAccountId, pageId: '', accessToken });

  const token: MetaToken = { farmaciaId: 0, adAccountId, pageId: pageId ?? '', accessToken };

  // ── 1) Copy: usa a do gestor; se faltar, usa uma copy padrão (SEM IA) ───────
  const copy = resolverCopy(
    input.criativos.copy,
    input.criativos.itens.map((i) => i.nome),
    input.conta.cliente ?? input.conta.nome,
  );

  // Usa o nome definido no wizard; se vier vazio, gera um padrão
  const nomeCampanha = (input.nomeCampanha?.trim()
    || `${input.conta.cliente ?? input.conta.nome ?? 'Campanha'} — ${input.objetivo.nome ?? input.objetivo.codigo}`
  ).slice(0, 100);

  // Destino WhatsApp (conversa) para Tráfego, Engajamento e Vendas — precisa de página.
  // Reconhecimento (alcance) e Cadastros não usam WhatsApp.
  const OBJ_WHATSAPP = ['OUTCOME_TRAFFIC', 'OUTCOME_ENGAGEMENT', 'OUTCOME_SALES'];
  const usarWhatsapp = !!pageId && OBJ_WHATSAPP.includes(input.objetivo.codigo);

  // ── 2) Criativos: sobe TODOS os PNGs, um AdCreative por imagem ──────────────
  const criativosMeta = await subirCriativos(
    token, pageId, input.criativos.itens, copy, usarWhatsapp ? 'whatsapp' : 'pagina', avisos,
    input.pagina?.instagramId,
  );

  exigirCriativos(criativosMeta, avisos, 'A campanha');

  // ── 3) Campanha ATIVA ───────────────────────────────────────────────────────
  const resultado = await criarCampanhaCompleta({
    token,
    nome:            nomeCampanha,
    objetivo:        input.objetivo.codigo,          // OUTCOME_*
    orcamentoDiario: input.orcamento.diarioCentavos, // centavos
    dataInicio:      input.orcamento.dataInicio,
    dataFim:         input.orcamento.dataFim,
    status:          'ACTIVE',
    whatsapp:        usarWhatsapp,
    publico: {
      genero:         GENERO_MAP[input.publico.genero] ?? 'ALL',
      idadeMin:       input.publico.idadeMin,
      idadeMax:       input.publico.idadeMax,
      localizacao:    input.publico.localizacao ?? null,
      raioKm:         input.publico.raioKm ?? 10,
      plataforma:     input.publico.plataforma,
      posicionamento: input.publico.posicionamento,
    },
    copy:      copy.textoPrincipal,
    criativos: criativosMeta,   // N criativos → N anúncios no mesmo conjunto
  });

  return { ...resultado, copyUsada: copy, avisos };
}

// ── Fluxo "partir de um conjunto existente" ───────────────────────────────────

export interface NovosAnunciosInput {
  /** Token do Meta resolvido pela rota (gestor ou geral). Nunca vem do cliente. */
  accessToken?: string;
  conta:      { id: string; nome?: string; cliente?: string };
  /** Página escolhida na etapa 1 (com o Instagram dela). Ver PublicarCampanhaInput. */
  pagina?:    { id: string; nome?: string; instagramId?: string | null } | null;
  conjuntoId: string;                 // conjunto de origem, que fica INTACTO
  nomeConjunto?: string;              // nome do conjunto de ORIGEM (base do nome dos anúncios)
  /** Nome que o gestor deu ao conjunto novo. Vazio = "<original> — Novos criativos". */
  nomeNovoConjunto?: string;
  destinoWhatsapp?: boolean;          // herdado do conjunto de origem
  publico:    { genero: 'todos' | 'homens' | 'mulheres'; idadeMin: number; idadeMax: number };
  /** `diarioCentavos` null = campanha CBO: o orçamento é o da campanha, não se mexe. */
  orcamento:  { diarioCentavos: number | null; dataInicio: string; dataFim: string | null };
  criativos:  { itens: ItemCriativo[]; copy: { textoPrincipal?: string; titulo?: string; descricao?: string } };
  ativar?:    boolean;                // false = cópia nasce pausada
}

export interface AnunciosNoConjuntoInput {
  /** Token do Meta resolvido pela rota (gestor ou geral). Nunca vem do cliente. */
  accessToken?: string;
  conta:      { id: string; nome?: string; cliente?: string };
  pagina?:    { id: string; nome?: string; instagramId?: string | null } | null;
  conjuntoId: string;                 // conjunto que RECEBE os anúncios
  nomeConjunto?: string;              // só para nomear os anúncios
  destinoWhatsapp?: boolean;          // o do próprio conjunto
  criativos:  { itens: ItemCriativo[]; copy: { textoPrincipal?: string; titulo?: string; descricao?: string } };
}

/**
 * Sobe os criativos novos como anúncios DENTRO do conjunto escolhido — sem
 * cópia, sem mexer em público nem orçamento. Nascem ATIVOS (decisão do dono):
 * dividem o orçamento que o conjunto já tem, então o gasto não aumenta.
 */
export async function publicarAnunciosNoConjunto(input: AnunciosNoConjuntoInput): Promise<{
  conjuntoId:      string;
  anuncioIds:      string[];
  linkGerenciador: string;
  copyUsada:       Copy;
  avisos:          string[];
}> {
  const avisos: string[] = [];
  const accessToken = input.accessToken ?? process.env.META_ACCESS_TOKEN ?? '';
  if (!accessToken) throw new Error('META_ACCESS_TOKEN não configurado no servidor.');

  const adAccountId = input.conta.id.startsWith('act_') ? input.conta.id : `act_${input.conta.id}`;
  const pageId = input.pagina?.id
    ?? await descobrirPageId({ farmaciaId: 0, adAccountId, pageId: '', accessToken });
  const token: MetaToken = { farmaciaId: 0, adAccountId, pageId: pageId ?? '', accessToken };

  const copy = resolverCopy(
    input.criativos.copy,
    input.criativos.itens.map((i) => i.nome),
    input.conta.cliente ?? input.conta.nome,
  );
  const criativosMeta = await subirCriativos(
    token, pageId, input.criativos.itens, copy,
    await resolverDestino(accessToken, input.conjuntoId, input.destinoWhatsapp), avisos,
    input.pagina?.instagramId,
  );

  const anuncioIds = criativosMeta.length
    ? await criarAnuncios(token, input.conjuntoId, criativosMeta, 'ACTIVE', dataDeInicioDoAnuncio(),
        await proximoNumeroDeAnuncio(token, input.conjuntoId).catch(() => 1))
    : [];

  if (!anuncioIds.length) avisos.push('Nenhum anúncio foi criado no conjunto.');

  return {
    conjuntoId: input.conjuntoId,
    anuncioIds,
    linkGerenciador: `https://www.facebook.com/adsmanager/manage/ads?act=${adAccountId.replace('act_', '')}&selected_adset_ids=${input.conjuntoId}`,
    copyUsada: copy,
    avisos,
  };
}

/**
 * Cria uma CÓPIA do conjunto escolhido (sem os anúncios antigos), aplica as
 * configurações que o gestor revisou e sobe os criativos novos dentro dela.
 * O conjunto original não é tocado — continua rodando com o aprendizado dele.
 */
export async function publicarNovosAnuncios(input: NovosAnunciosInput): Promise<{
  conjuntoId:      string;
  /** true = o /copies do Meta foi recusado e o conjunto foi criado do zero. */
  conjuntoRecriado: boolean;
  anuncioIds:      string[];
  linkGerenciador: string;
  copyUsada:       Copy;
  avisos:          string[];
}> {
  const avisos: string[] = [];
  const accessToken = input.accessToken ?? process.env.META_ACCESS_TOKEN ?? '';
  if (!accessToken) throw new Error('META_ACCESS_TOKEN não configurado no servidor.');

  const adAccountId = input.conta.id.startsWith('act_') ? input.conta.id : `act_${input.conta.id}`;
  // Página do Facebook: a que o gestor escolheu; só adivinha se não veio.
  const pageId = input.pagina?.id
    ?? await descobrirPageId({ farmaciaId: 0, adAccountId, pageId: '', accessToken });
  const token: MetaToken = { farmaciaId: 0, adAccountId, pageId: pageId ?? '', accessToken };

  const status: 'ACTIVE' | 'PAUSED' = input.ativar ? 'ACTIVE' : 'PAUSED';

  const SUFIXO = ' — Novos criativos';
  // Nome escolhido pelo gestor. O /copies só sabe acrescentar sufixo, então
  // ele é aplicado depois (passo 2); na recriação já nasce com ele.
  const nomeNovo = input.nomeNovoConjunto?.trim().slice(0, 100) || undefined;

  // 0) Criativos PRIMEIRO. Eles ficam na conta, não no conjunto — então dá para
  // subir antes de copiar. Se nenhum passar (app do Meta em desenvolvimento,
  // página sem WhatsApp Business...), nada é criado: antes sobrava um conjunto
  // vazio no Gerenciador.
  const copy = resolverCopy(
    input.criativos.copy,
    input.criativos.itens.map((i) => i.nome),
    input.conta.cliente ?? input.conta.nome,
  );
  const criativosMeta = await subirCriativos(
    token, pageId, input.criativos.itens, copy,
    await resolverDestino(accessToken, input.conjuntoId, input.destinoWhatsapp), avisos,
    input.pagina?.instagramId,
  );
  exigirCriativos(criativosMeta, avisos, 'O conjunto');

  // 1) Cópia SEM os anúncios antigos — só queremos a configuração herdada.
  let novoConjuntoId: string;
  let configAplicada = false;     // o caminho de recriação já nasce com a config revisada
  let conjuntoRecriado = false;   // false = veio do /copies do Meta
  try {
    const copia = await duplicarConjunto(accessToken, input.conjuntoId, {
      comAnuncios: false,
      status,
      sufixo:      SUFIXO,
    });
    novoConjuntoId = copia.conjuntoId;
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === 'META_TOKEN_EXPIRADO') throw e;   // não adianta tentar de outro jeito
    // O /copies arrasta configurações do original que o Meta revalida e pode
    // recusar (janela de atribuição antiga é o caso comum). Recriar o conjunto
    // com os mesmos campos contorna isso — e não custa histórico, porque cópia
    // do Meta também nasce em aprendizado novo.
    logger.warn({ err: msg, conjunto: input.conjuntoId }, 'POST /copies recusado — recriando o conjunto do zero');
    let novo: Awaited<ReturnType<typeof recriarConjunto>>;
    try {
      novo = await recriarConjunto(accessToken, adAccountId, input.conjuntoId, {
        status,
        sufixo:                  SUFIXO,
        nome:                    nomeNovo,
        orcamentoDiarioCentavos: input.orcamento.diarioCentavos ?? undefined,
        dataInicio:              input.orcamento.dataInicio,
        dataFim:                 input.orcamento.dataFim,
        publico:                 input.publico,
      });
    } catch (e2) {
      // Beco sem saída do Meta (medido em 02/10/2026): a cópia é recusada pela
      // janela de atribuição antiga — que não pode mais ser editada depois de
      // criado o conjunto — e o conjunto novo exige anunciante verificado, que
      // só o Gerenciador informa. Colocar anúncios no conjunto existente funciona.
      if ((e2 as Error).message === ERRO_ANUNCIANTE_VERIFICADO) {
        throw new Error(
          'Este conjunto não pode ser duplicado pelo app. O Meta recusa a cópia por causa da janela de atribuição antiga '
          + 'do conjunto (que não pode mais ser alterada) e, nesta conta, conjunto novo exige anunciante verificado, que só '
          + 'o Gerenciador informa. Use "Novos anúncios" para colocar os criativos neste conjunto, ou duplique o conjunto '
          + 'pelo Gerenciador de Anúncios. Nada foi publicado.',
        );
      }
      throw e2;
    }
    novoConjuntoId = novo.conjuntoId;
    configAplicada = true;
    conjuntoRecriado = true;
    // Começa pelo que deu certo. A frase antiga abria com "O Meta não aceitou
    // duplicar..." e o gestor lia como falha — sendo que a publicação funcionou
    // e o conjunto foi duplicado, só que por outro caminho. A mensagem crua do
    // Meta fica no log; aqui interessa o resultado.
    avisos.push('Conjunto duplicado. O Meta recusou a cópia direta, então criamos um conjunto novo com a mesma configuração e publicamos os anúncios nele. O conjunto original não foi alterado e segue rodando.');
    if (novo.placementsAutomaticos) {
      avisos.push('Os posicionamentos do conjunto original não foram aceitos pelo Meta; o conjunto novo ficou com posicionamentos automáticos (Advantage+). Público, idade e localização seguem iguais.');
    }
  }

  // 2) Aplica o que o gestor revisou na etapa de público/orçamento.
  if (!configAplicada) {
    try {
      await atualizarConjunto(accessToken, novoConjuntoId, {
        nome:                    nomeNovo,
        orcamentoDiarioCentavos: input.orcamento.diarioCentavos ?? undefined,
        dataInicio:              input.orcamento.dataInicio,
        dataFim:                 input.orcamento.dataFim,
        publico:                 input.publico,
      });
    } catch (e) {
      // A cópia já existe; sem isso ela roda com a config herdada do original.
      const msg = (e as Error).message;
      logger.warn({ err: msg, conjunto: novoConjuntoId }, 'Falha ao aplicar configs na cópia');
      avisos.push(`As configurações revisadas não puderam ser aplicadas (${msg}). A cópia ficou com a configuração do conjunto original.`);
      // O nome não depende do resto: tenta sozinho, para não perder o que o gestor digitou.
      if (nomeNovo) {
        await atualizarConjunto(accessToken, novoConjuntoId, { nome: nomeNovo }).catch((e2) => {
          avisos.push(`O nome "${nomeNovo}" não pôde ser aplicado (${(e2 as Error).message}); renomeie no Gerenciador.`);
        });
      }
    }
  }

  // 3) Anúncios dentro da cópia (os criativos já subiram no passo 0).

  const anuncioIds = criativosMeta.length
    ? await criarAnuncios(token, novoConjuntoId, criativosMeta, status, dataDeInicioDoAnuncio(input.orcamento.dataInicio))
    : [];

  if (!anuncioIds.length) {
    avisos.push('O conjunto novo foi criado, mas ficou sem anúncios.');
  }

  return {
    conjuntoId: novoConjuntoId,
    conjuntoRecriado,
    anuncioIds,
    linkGerenciador: `https://www.facebook.com/adsmanager/manage/adsets?act=${adAccountId.replace('act_', '')}&selected_adset_ids=${novoConjuntoId}`,
    copyUsada: copy,
    avisos,
  };
}
