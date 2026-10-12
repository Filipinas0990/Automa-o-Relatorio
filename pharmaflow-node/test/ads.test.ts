/**
 * Bot de criação de campanhas (WhatsApp/Web) e configuração Meta por cliente.
 *
 * Escrito como rede de regressão ANTES de ads/service.ts, repository.ts,
 * geocode.ts e routes.ts virarem classes (AdsService/AdsController/
 * TokenMetaRepository/CampanhaPendenteRepository/ContaAnuncioCacheRepository/
 * GeocodificadorCidade) — este módulo nunca teve teste automatizado. Meta,
 * OpenAI e Nominatim NUNCA são chamados de verdade: o `fetch` global é
 * substituído, igual ao padrão usado nas demais suítes.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { api, criarGestor, criarFarmacia, limparBanco } from './helpers';

const resposta = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

/**
 * Resposta de chat da OpenAI contendo o JSON que a IA devolveria.
 * O SDK da OpenAI (diferente dos outros clientes HTTP deste projeto) decide
 * como ler o corpo pelo header Content-Type — sem ele, devolve o texto cru.
 */
function respostaOpenAI(json: unknown) {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(json) } }] }), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  process.env.META_ACCESS_TOKEN = 'token-geral-de-teste';
  process.env.OPENAI_API_KEY = 'sk-teste';
});
afterEach(() => {
  delete process.env.META_ACCESS_TOKEN;
  delete process.env.OPENAI_API_KEY;
  vi.unstubAllGlobals();
});

describe('Autenticação', () => {
  beforeEach(limparBanco);

  it('exige autenticação em todas as rotas', async () => {
    expect((await api('GET', '/api/ads/campanhas')).status).toBe(401);
    expect((await api('GET', '/api/ads/contas')).status).toBe(401);
    expect((await api('GET', '/api/ads/geo-busca?q=sp')).status).toBe(401);
    expect((await api('GET', '/api/ads/geo-coordenadas?nome=Fortaleza')).status).toBe(401);
    expect((await api('POST', '/api/ads/chat')).status).toBe(401);
    expect((await api('POST', '/api/ads/tokens')).status).toBe(401);
    expect((await api('GET', '/api/ads/token-status')).status).toBe(401);
  });

  it('só admin cadastra token Meta e lê o status do token geral', async () => {
    const gestor = await criarGestor();
    expect((await api('POST', '/api/ads/tokens', {
      token: gestor.token, body: { farmacia_id: 1, ad_account_id: 'act_1', page_id: 'p1' },
    })).status).toBe(403);
    expect((await api('GET', '/api/ads/token-status', { token: gestor.token })).status).toBe(403);
  });
});

describe('Geolocalização', () => {
  beforeEach(limparBanco);

  it('404 vira coordenada null; exige o nome da cidade', async () => {
    const g = await criarGestor();
    expect((await api('GET', '/api/ads/geo-coordenadas', { token: g.token })).status).toBe(400);
  });

  it('busca a coordenada da cidade no Nominatim', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resposta([{ lat: '-3.71', lon: '-38.54' }])));

    const g = await criarGestor();
    const r = await api('GET', '/api/ads/geo-coordenadas?nome=Fortaleza&regiao=Cear%C3%A1', { token: g.token });
    expect(r.status).toBe(200);
    expect(r.body.coordenada).toEqual({ lat: -3.71, lon: -38.54 });
  });

  it('busca localizações (autocomplete) na Meta', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      resposta({ data: [{ key: '2450022', name: 'São Paulo', region: 'São Paulo' }] }),
    ));

    const g = await criarGestor();
    const r = await api('GET', '/api/ads/geo-busca?q=sao+paulo', { token: g.token });
    expect(r.status).toBe(200);
    expect(r.body.resultados).toEqual([{ key: '2450022', nome: 'São Paulo', regiao: 'São Paulo' }]);
  });

  it('400 quando não há token Meta (sem META_ACCESS_TOKEN e sem Facebook conectado)', async () => {
    delete process.env.META_ACCESS_TOKEN;
    const g = await criarGestor();
    const r = await api('GET', '/api/ads/geo-busca?q=sp', { token: g.token });
    expect(r.status).toBe(400);
  });
});

describe('Contas de anúncio (cache)', () => {
  beforeEach(limparBanco);

  it('sincroniza e devolve as contas na primeira chamada (sem cache)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resposta({
      data: [{
        id: 'act_111', account_id: '111', name: 'Conta Um',
        account_status: 1, currency: 'BRL',
        business: { name: 'BM Um' }, funding_source_details: { display_string: 'Saldo' },
      }],
    })));

    const g = await criarGestor();
    const r = await api('GET', '/api/ads/contas', { token: g.token });
    expect(r.status).toBe(200);
    expect(r.body.contas).toHaveLength(1);
    expect(r.body.contas[0]).toMatchObject({ id: 'act_111', nome: 'Conta Um', ativa: true });
  });

  it('na segunda chamada serve do cache, sem bater na Meta de novo', async () => {
    const chamadas = vi.fn(async () => resposta({
      data: [{ id: 'act_222', account_id: '222', name: 'Conta Dois', account_status: 1, currency: 'BRL' }],
    }));
    vi.stubGlobal('fetch', chamadas);

    const g = await criarGestor();
    await api('GET', '/api/ads/contas', { token: g.token });
    const chamadasApósPrimeira = chamadas.mock.calls.length;

    const segunda = await api('GET', '/api/ads/contas', { token: g.token });
    expect(segunda.status).toBe(200);
    expect(segunda.body.contas[0].nome).toBe('Conta Dois');
    // Cache fresco: não deveria ter feito nenhuma chamada nova à Meta.
    expect(chamadas.mock.calls.length).toBe(chamadasApósPrimeira);
  });

  it('502 com a mensagem de token expirado quando a Meta recusa o token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      resposta({ error: { message: 'token inválido', code: 190 } }),
    ));

    const g = await criarGestor();
    const r = await api('GET', '/api/ads/contas', { token: g.token });
    expect(r.status).toBe(502);
    expect(r.body.detail).toContain('Token do Meta expirado');
  });
});

describe('Status do token geral', () => {
  beforeEach(limparBanco);

  it('configurado:false quando META_ACCESS_TOKEN não está definido', async () => {
    delete process.env.META_ACCESS_TOKEN;
    const admin = await criarGestor({ isAdmin: true });
    const r = await api('GET', '/api/ads/token-status', { token: admin.token });
    expect(r.status).toBe(200);
    expect(r.body.configurado).toBe(false);
  });

  it('verifica a validade do token na Meta quando configurado', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resposta({
      data: { is_valid: true, expires_at: 0 },
    })));

    const admin = await criarGestor({ isAdmin: true });
    const r = await api('GET', '/api/ads/token-status', { token: admin.token });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ configurado: true, valido: true, diasRestantes: null });
  });
});

describe('Cadastro de token Meta por cliente', () => {
  beforeEach(limparBanco);

  it('admin cadastra a conta de anúncio e a página de uma farmácia', async () => {
    const admin = await criarGestor({ isAdmin: true });
    const farmacia = await criarFarmacia(admin.id);

    const r = await api('POST', '/api/ads/tokens', {
      token: admin.token,
      body: { farmacia_id: farmacia.id, ad_account_id: 'act_999', page_id: 'page_999' },
    });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });
});

describe('Campanhas do gestor', () => {
  beforeEach(limparBanco);

  it('lista vazia quando o gestor não tem campanha publicada na semana', async () => {
    const g = await criarGestor();
    const r = await api('GET', '/api/ads/campanhas', { token: g.token });
    expect(r.status).toBe(200);
    expect(r.body).toEqual([]);
  });
});

describe('Chat do bot (Web)', () => {
  beforeEach(limparBanco);

  it('responde uma saudação sem iniciar campanha', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respostaOpenAI({
      tipo: 'outro',
      campanha: null,
      respostaSugerida: 'Olá! Como posso ajudar com sua campanha hoje?',
    })));

    const g = await criarGestor();
    const r = await api('POST', '/api/ads/chat', { token: g.token, body: { texto: 'oi' } });
    expect(r.status).toBe(200);
    expect(r.body.resposta).toContain('Como posso ajudar');
  });

  it('avisa quando o cliente mencionado não existe no sistema', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respostaOpenAI({
      tipo: 'campanha',
      campanha: {
        clienteNome: 'Farmácia Fantasma', objetivo: 'LINK_CLICKS', orcamentoDiario: 2000,
        publico: { genero: 'ALL', idadeMin: 18, idadeMax: 65, localizacao: null },
        dataInicio: '2026-01-01', dataFim: null, copy: 'Promoção!', temMidia: false,
        camposFaltando: [],
      },
      respostaSugerida: '',
    })));

    const g = await criarGestor();
    const r = await api('POST', '/api/ads/chat', { token: g.token, body: { texto: 'criar campanha pra Farmácia Fantasma' } });
    expect(r.status).toBe(200);
    expect(r.body.resposta).toContain('não encontrado no sistema');
  });

  it('pede os campos que faltam antes de montar a campanha', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respostaOpenAI({
      tipo: 'campanha',
      campanha: {
        clienteNome: null, objetivo: null, orcamentoDiario: null,
        publico: { genero: null, idadeMin: null, idadeMax: null, localizacao: null },
        dataInicio: null, dataFim: null, copy: null, temMidia: false,
        camposFaltando: ['clienteNome', 'objetivo', 'orcamentoDiario', 'dataInicio', 'copy'],
      },
      respostaSugerida: 'Para qual cliente é a campanha?',
    })));

    const g = await criarGestor();
    const r = await api('POST', '/api/ads/chat', { token: g.token, body: { texto: 'quero criar uma campanha' } });
    expect(r.status).toBe(200);
    expect(r.body.resposta).toBe('Para qual cliente é a campanha?');
  });

  it('cria a campanha pendente e, ao confirmar, publica no Meta', async () => {
    const admin  = await criarGestor({ isAdmin: true });
    const gestor = await criarGestor();
    const farmacia = await criarFarmacia(gestor.id, { nome: 'Farmácia Modelo' });
    await api('POST', '/api/ads/tokens', {
      token: admin.token,
      body: { farmacia_id: farmacia.id, ad_account_id: 'act_777', page_id: 'page_777' },
    });

    const campanhaExtraida = {
      clienteNome: 'Farmácia Modelo', objetivo: 'LINK_CLICKS', orcamentoDiario: 3000,
      publico: { genero: 'ALL', idadeMin: 18, idadeMax: 65, localizacao: null },
      dataInicio: '2026-01-01', dataFim: null, copy: 'Promoção imperdível!', temMidia: false,
      camposFaltando: [],
    };

    // 1) Mensagem com a campanha completa → cria o pendente, pede confirmação.
    vi.stubGlobal('fetch', vi.fn(async () => respostaOpenAI({
      tipo: 'campanha', campanha: campanhaExtraida, respostaSugerida: '',
    })));
    const pedido = await api('POST', '/api/ads/chat', {
      token: gestor.token, body: { texto: 'criar campanha pra Farmácia Modelo' },
    });
    expect(pedido.status).toBe(200);
    expect(pedido.body.resposta).toContain('Confirma para publicar');

    // 2) Confirmação → publica no Meta (campanha + conjunto, sem criativo pois não há imagem).
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/campaigns')) return resposta({ id: 'CAMP1' });
      if (u.includes('/adsets') && !u.includes('?')) return resposta({ id: 'ADSET1' });
      return respostaOpenAI({ tipo: 'confirmacao', campanha: null, respostaSugerida: '' });
    }));
    const confirmacao = await api('POST', '/api/ads/chat', { token: gestor.token, body: { texto: 'sim' } });
    expect(confirmacao.status).toBe(200);
    expect(confirmacao.body.resposta).toContain('Campanha criada com sucesso');
  });
});
