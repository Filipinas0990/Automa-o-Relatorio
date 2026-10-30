/**
 * Campanhas no Meta Ads: criação a partir do wizard, novos anúncios em
 * conjuntos existentes e o gerenciador (leitura + duplicação).
 *
 * Escrito como rede de regressão ANTES de campanhas/service.ts, routes.ts e
 * publicacoes.ts virarem classes (CampanhaService/CampanhaController/
 * PublicacaoAssincrona) — garante que o comportamento HTTP não muda na
 * conversão. O Meta NUNCA é chamado de verdade: o `fetch` global é
 * substituído, igual ao padrão já usado em disparos.test.ts e whatsapp.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { api, criarGestor, limparBanco } from './helpers';

const resposta = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

beforeEach(() => {
  process.env.META_ACCESS_TOKEN = 'token-geral-de-teste';
});
afterEach(() => {
  delete process.env.META_ACCESS_TOKEN;
  vi.unstubAllGlobals();
});

describe('Autenticação', () => {
  beforeEach(limparBanco);

  it('exige autenticação em todas as rotas', async () => {
    expect((await api('GET', '/api/campanhas/paginas?conta=act_1')).status).toBe(401);
    expect((await api('POST', '/api/campanhas/midias')).status).toBe(401);
    expect((await api('POST', '/api/campanhas/criar')).status).toBe(401);
    expect((await api('GET', '/api/campanhas/conjuntos?conta=act_1')).status).toBe(401);
    expect((await api('GET', '/api/campanhas/publicacoes/abc')).status).toBe(401);
  });
});

describe('Validações sem tocar no Meta', () => {
  beforeEach(limparBanco);

  it('recusa quando a conta de anúncios não é informada', async () => {
    const g = await criarGestor();
    expect((await api('GET', '/api/campanhas/paginas', { token: g.token })).status).toBe(400);
    expect((await api('GET', '/api/campanhas/conjuntos', { token: g.token })).status).toBe(400);
    expect((await api('POST', '/api/campanhas/midias', {
      token: g.token, body: { pngBase64: 'YQ==' },
    })).status).toBe(400);
    expect((await api('POST', '/api/campanhas/criar', {
      token: g.token, body: { objetivo: { codigo: 'OUTCOME_TRAFFIC' } },
    })).status).toBe(400);
  });

  it('recusa criar campanha sem objetivo ou com orçamento fora da faixa', async () => {
    const g = await criarGestor();

    expect((await api('POST', '/api/campanhas/criar', {
      token: g.token, body: { conta: { id: 'act_1' } },
    })).status).toBe(400);

    const semOrcamento = await api('POST', '/api/campanhas/criar', {
      token: g.token,
      body: { conta: { id: 'act_1' }, objetivo: { codigo: 'OUTCOME_TRAFFIC' }, orcamento: { diarioCentavos: 0 } },
    });
    expect(semOrcamento.status).toBe(400);

    const orcamentoAlto = await api('POST', '/api/campanhas/criar', {
      token: g.token,
      body: { conta: { id: 'act_1' }, objetivo: { codigo: 'OUTCOME_TRAFFIC' }, orcamento: { diarioCentavos: 999999 } },
    });
    expect(orcamentoAlto.status).toBe(400);
  });

  it('recusa novos-anuncios e anuncios sem criativos', async () => {
    const g = await criarGestor();

    expect((await api('POST', '/api/campanhas/conjuntos/123/novos-anuncios', {
      token: g.token,
      body: { conta: { id: 'act_1' }, orcamento: { diarioCentavos: 1000 }, criativos: { itens: [] } },
    })).status).toBe(400);

    expect((await api('POST', '/api/campanhas/conjuntos/123/anuncios', {
      token: g.token,
      body: { conta: { id: 'act_1' }, criativos: { itens: [] } },
    })).status).toBe(400);
  });
});

describe('Páginas e conjuntos (leitura)', () => {
  beforeEach(limparBanco);

  it('lista as páginas do Business Manager da conta', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('?fields=business')) return resposta({ business: { id: 'BIZ1' } });
      if (u.includes('/owned_pages')) {
        return resposta({ data: [{ id: 'PAGE1', name: 'Farmácia Central', instagram_business_account: { id: 'IG1', username: 'farmacentral' } }] });
      }
      return resposta({ data: [] });
    }));

    const g = await criarGestor();
    const r = await api('GET', '/api/campanhas/paginas?conta=act_1', { token: g.token });
    expect(r.status).toBe(200);
    expect(r.body.paginas).toEqual([
      { id: 'PAGE1', nome: 'Farmácia Central', instagramId: 'IG1', instagramNome: 'farmacentral' },
    ]);
  });

  it('lista os conjuntos (ad sets) da conta', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/adsets')) {
        return resposta({
          data: [{
            id: 'ADSET1', name: 'Conjunto 1', effective_status: 'ACTIVE',
            daily_budget: '1000', optimization_goal: 'LINK_CLICKS',
            campaign: { id: 'CAMP1', name: 'Campanha 1' },
          }],
        });
      }
      return resposta({ data: [] });
    }));

    const g = await criarGestor();
    const r = await api('GET', '/api/campanhas/conjuntos?conta=act_1', { token: g.token });
    expect(r.status).toBe(200);
    expect(r.body.conjuntos).toHaveLength(1);
    expect(r.body.conjuntos[0]).toMatchObject({ id: 'ADSET1', nome: 'Conjunto 1', ativa: true, orcamentoDiario: 10 });
  });

  it('502 com a mensagem de token expirado quando o Meta recusa o token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      resposta({ error: { message: 'token inválido', code: 190 } }),
    ));

    const g = await criarGestor();
    const r = await api('GET', '/api/campanhas/conjuntos?conta=act_1', { token: g.token });
    expect(r.status).toBe(502);
    expect(r.body.detail).toContain('Token do Meta expirado');
  });
});

describe('Upload de mídia', () => {
  beforeEach(limparBanco);

  it('sobe uma imagem e devolve o hash', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      resposta({ images: { abc: { hash: 'HASH1', url: 'https://img', name: 'criativo' } } }),
    ));

    const g = await criarGestor();
    const r = await api('POST', '/api/campanhas/midias', {
      token: g.token, body: { conta: { id: 'act_1' }, nome: 'criativo', pngBase64: 'YQ==' },
    });
    expect(r.status).toBe(200);
    expect(r.body.hash).toBe('HASH1');
  });

  it('400 quando falta a imagem', async () => {
    const g = await criarGestor();
    const r = await api('POST', '/api/campanhas/midias', { token: g.token, body: { conta: { id: 'act_1' } } });
    expect(r.status).toBe(400);
  });
});

describe('Criar campanha (fluxo completo)', () => {
  beforeEach(limparBanco);

  /**
   * Mock mínimo para publicarCampanha: a página já vem no payload (não
   * precisa descobrir), então só entram upload de imagem, criativo, campanha,
   * conjunto e o anúncio.
   */
  function simularMetaParaCriar() {
    const idsAnuncio: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string }) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      if (u.includes('/adimages')) return resposta({ images: { x: { hash: 'HASH1', url: 'https://img', name: 'x' } } });
      if (u.includes('/adcreatives')) return resposta({ id: 'CREATIVE1' });
      if (u.includes('/campaigns')) return resposta({ id: 'CAMP1' });
      if (u.includes('/adsets') && method === 'POST') return resposta({ id: 'ADSET1' });
      if (u.includes('/ads') && method === 'POST') {
        const id = `AD${idsAnuncio.length + 1}`;
        idsAnuncio.push(id);
        return resposta({ id });
      }
      return resposta({});
    }));
    return idsAnuncio;
  }

  const payloadBasico = {
    conta:    { id: 'act_1', cliente: 'Farmácia Central' },
    pagina:   { id: 'PAGE1', instagramId: null },
    objetivo: { codigo: 'OUTCOME_TRAFFIC' },
    publico:  { genero: 'todos', idadeMin: 18, idadeMax: 65 },
    orcamento: { diarioCentavos: 1000, dataInicio: '2026-01-01', dataFim: null },
    criativos: {
      itens: [{ nome: 'Produto A', pngBase64: 'YQ==' }],
      copy:  { textoPrincipal: 'Confira nossa oferta!' },
    },
  };

  it('publica a campanha síncrona e devolve os ids do Meta', async () => {
    simularMetaParaCriar();
    const g = await criarGestor();

    const r = await api('POST', '/api/campanhas/criar', { token: g.token, body: payloadBasico });
    expect(r.status).toBe(201);
    expect(r.body.campanhaId).toBe('CAMP1');
    expect(r.body.conjuntoId).toBe('ADSET1');
    expect(r.body.anuncioIds).toEqual(['AD1']);
    expect(r.body.avisos).toEqual([]);
  });

  it('publica no modo assíncrono: 202 com id, depois concluída via polling', async () => {
    simularMetaParaCriar();
    const g = await criarGestor();

    const inicio = await api('POST', '/api/campanhas/criar?assincrono=1', { token: g.token, body: payloadBasico });
    expect(inicio.status).toBe(202);
    const publicacaoId = inicio.body.publicacaoId;
    expect(publicacaoId).toBeTruthy();

    // A publicação roda em segundo plano — espera terminar.
    let tentativas = 0;
    let consulta;
    do {
      consulta = await api('GET', `/api/campanhas/publicacoes/${publicacaoId}`, { token: g.token });
      if (consulta.body.status === 'concluida') break;
      await new Promise((r) => setTimeout(r, 20));
    } while (++tentativas < 50);

    expect(consulta.body.status).toBe('concluida');
    expect(consulta.body.codigo).toBe(201);
    expect(consulta.body.corpo.campanhaId).toBe('CAMP1');
  });

  it('404 ao consultar uma publicação desconhecida', async () => {
    const g = await criarGestor();
    const r = await api('GET', '/api/campanhas/publicacoes/00000000-0000-0000-0000-000000000000', { token: g.token });
    expect(r.status).toBe(404);
  });

  it('502 quando nenhum criativo é aceito pelo Meta', async () => {
    // Sem imagem nenhuma no criativo: subirCriativos nem chama o Meta.
    const g = await criarGestor();
    const r = await api('POST', '/api/campanhas/criar', {
      token: g.token,
      body: { ...payloadBasico, criativos: { itens: [{ nome: 'Sem imagem' }], copy: {} } },
    });
    expect(r.status).toBe(502);
    expect(r.body.detail).toContain('nenhum criativo foi aceito');
  });
});

describe('Duplicar conjunto', () => {
  beforeEach(limparBanco);

  it('duplica o conjunto e devolve o novo id', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/copies')) return resposta({ copied_adset_id: 'ADSET-COPY1', ad_object_ids: [{ copied_id: 'AD-COPY1' }] });
      return resposta({});
    }));

    const g = await criarGestor();
    const r = await api('POST', '/api/campanhas/conjuntos/ADSET1/duplicar', {
      token: g.token, body: { quantidade: 1 },
    });
    expect(r.status).toBe(201);
    expect(r.body.criados).toHaveLength(1);
  });
});
