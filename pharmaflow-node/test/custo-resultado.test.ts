/**
 * Custo por resultado do Meta (7, 15 e 30 dias) — regras puras, job e rota.
 * O Meta NUNCA é chamado de verdade: o `fetch` global é substituído.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../src/database/db';
import { metaTokens, custoResultadoMeta } from '../src/database/schema';
import { custoResultadoService } from '../src/composicao';
import { periodoDaJanela, resumirCampanhas, agoraBrasilia } from '../src/custo/calculo';
import { api, criarGestor, criarFarmacia, limparBanco } from './helpers';

const WPP = 'onsite_conversion.messaging_conversation_started_7d';
const resposta = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
/** Conjuntos da conta: c1 leva para o WhatsApp, c-site não. */
const ADSETS = { data: [
  { campaign_id: 'c1', destination_type: 'WHATSAPP' },
  { campaign_id: 'c-site', destination_type: 'WEBSITE' },
] };

describe('Janelas (terminam ONTEM, fuso de Brasília)', () => {
  // 18/10/2026 10:00 em Brasília (UTC-3)
  const agora = new Date('2026-10-18T13:00:00Z');

  it('7, 15 e 30 dias terminam ontem', () => {
    expect(periodoDaJanela(7,  agora)).toEqual({ inicio: '2026-10-11', fim: '2026-10-17' });
    expect(periodoDaJanela(15, agora)).toEqual({ inicio: '2026-10-03', fim: '2026-10-17' });
    expect(periodoDaJanela(30, agora)).toEqual({ inicio: '2026-09-18', fim: '2026-10-17' });
  });

  it('usa a data de Brasília, não a do UTC (01:00 UTC ainda é o dia anterior aqui)', () => {
    const quaseMeiaNoiteUtc = new Date('2026-10-19T01:00:00Z'); // 22:00 de 18/10 em Brasília
    expect(periodoDaJanela(7, quaseMeiaNoiteUtc).fim).toBe('2026-10-17');
    expect(agoraBrasilia(quaseMeiaNoiteUtc)).toEqual({ data: '2026-10-18', hora: 22 });
  });
});

describe('Resumo das campanhas (só WhatsApp)', () => {
  const wpp = new Set(['c1', 'c2']);

  it('soma só as campanhas de WhatsApp; o gasto das sem conversa entra', () => {
    const r = resumirCampanhas([
      { campaign_id: 'c1', spend: '100.00', clicks: '50', impressions: '1000', actions: [{ action_type: WPP, value: '10' }] },
      { campaign_id: 'c2', spend: '50.00',  clicks: '20', impressions: '500' },   // WhatsApp sem conversa
    ], wpp);
    expect(r.gasto).toBe(150);
    expect(r.resultados).toBe(10);
    expect(r.custoPorResultado).toBe(15);
    expect(r.tipoResultado).toBe('Conversas no WhatsApp');
    expect(r.cliques).toBe(70);
    expect(r.impressoes).toBe(1500);
  });

  it('campanha que não é de WhatsApp fica fora do gasto e dos resultados', () => {
    const r = resumirCampanhas([
      { campaign_id: 'c1', spend: '100', actions: [{ action_type: WPP, value: '10' }] },
      { campaign_id: 'site', spend: '900', actions: [{ action_type: 'lead', value: '30' }, { action_type: 'purchase', value: '5' }] },
    ], wpp);
    expect(r.gasto).toBe(100);
    expect(r.resultados).toBe(10);
    expect(r.custoPorResultado).toBe(10);
  });

  it('lead, compra e clique não são resultado', () => {
    const r = resumirCampanhas([
      { campaign_id: 'c1', spend: '30', actions: [{ action_type: 'lead', value: '9' }, { action_type: 'link_click', value: '99' }] },
    ], wpp);
    expect(r.gasto).toBe(30);
    expect(r.resultados).toBe(0);
    expect(r.custoPorResultado).toBeNull();
    expect(r.tipoResultado).toBeNull();
  });

  it('conta sem campanha de WhatsApp: tudo zerado, sem dividir por zero', () => {
    expect(resumirCampanhas([{ campaign_id: 'site', spend: '80' }], new Set())).toEqual({
      gasto: 0, resultados: 0, custoPorResultado: null, tipoResultado: null, cliques: 0, impressoes: 0,
    });
  });
});

describe('Job de custo por resultado', () => {
  beforeEach(async () => {
    await limparBanco();
    process.env.META_ACCESS_TOKEN = 'token-geral-de-teste';
  });
  afterEach(() => {
    delete process.env.META_ACCESS_TOKEN;
    vi.unstubAllGlobals();
  });

  async function farmaciaComConta(gestorId: number, conta: string) {
    const f = await criarFarmacia(gestorId);
    await db.insert(metaTokens).values({ farmaciaId: f.id, adAccountId: conta, pageId: 'p1' });
    return f;
  }

  it('grava as 3 janelas e a rota devolve o custo por resultado', async () => {
    const gestor = await criarGestor();
    const f = await farmaciaComConta(gestor.id, 'act_111');

    const periodosPedidos: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = new URL(String(url));
      if (u.pathname.endsWith('/act_111/adsets')) return resposta(ADSETS);
      expect(u.pathname).toContain('/act_111/insights');
      expect(u.searchParams.get('level')).toBe('campaign');
      periodosPedidos.push(u.searchParams.get('time_range')!);
      return resposta({ data: [
        { campaign_id: 'c1', spend: '200', clicks: '40', impressions: '900', actions: [{ action_type: WPP, value: '8' }] },
        // campanha de site: não pode entrar no custo
        { campaign_id: 'c-site', spend: '999', actions: [{ action_type: 'lead', value: '50' }] },
      ] });
    }));

    const agora = new Date('2026-10-18T09:00:00Z');
    const resumo = await custoResultadoService.sincronizarTodas(agora);
    expect(resumo).toEqual({ farmaciasOk: 1, farmaciasErro: 0 });
    expect(periodosPedidos.map((p) => JSON.parse(p).until)).toEqual(['2026-10-17', '2026-10-17', '2026-10-17']);

    const r = await api('GET', '/api/custo-resultado', { token: gestor.token });
    expect(r.status).toBe(200);
    const linha = (r.body as { farmacias: Array<Record<string, any>> }).farmacias.find((x) => x.farmacia_id === f.id)!;
    expect(linha.janela_7d.custo_por_resultado).toBe(25);
    expect(linha.janela_15d.resultados).toBe(8);
    expect(linha.janela_30d.periodo_inicio).toBe('2026-09-18');
    expect(linha.erro).toBeNull();
  });

  it('uma conta com erro não derruba as outras e mantém o último número bom', async () => {
    const gestor = await criarGestor();
    const boa  = await farmaciaComConta(gestor.id, 'act_ok');
    const ruim = await farmaciaComConta(gestor.id, 'act_ruim');

    let falhar = false;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('act_ruim') && falhar) {
        return resposta({ error: { message: 'sem permissão', code: 200 } });
      }
      if (String(url).includes('/adsets')) return resposta(ADSETS);
      return resposta({ data: [{ campaign_id: 'c1', spend: '100', actions: [{ action_type: WPP, value: '4' }] }] });
    }));

    await custoResultadoService.sincronizarTodas();
    falhar = true;
    const resumo = await custoResultadoService.sincronizarTodas();
    expect(resumo).toEqual({ farmaciasOk: 1, farmaciasErro: 1 });

    const [linha7] = await db.select().from(custoResultadoMeta)
      .where(eq(custoResultadoMeta.farmaciaId, ruim.id));
    expect(linha7.erro).toContain('sem permissão');
    expect(linha7.custoPorResultado).toBe('25.00');   // número da leitura anterior continua lá

    const [ok] = await db.select().from(custoResultadoMeta).where(eq(custoResultadoMeta.farmaciaId, boa.id));
    expect(ok.erro).toBeNull();
  });

  it('só roda a partir das 06:00 de Brasília e uma vez por dia', async () => {
    const gestor = await criarGestor();
    await farmaciaComConta(gestor.id, 'act_222');
    // 1 chamada de conjuntos + 3 de insights (7, 15 e 30 dias)
    const fetchFalso = vi.fn(async () => resposta({ data: [] }));
    vi.stubGlobal('fetch', fetchFalso);

    // 05:59 em Brasília (08:59 UTC) — ainda não
    expect(await custoResultadoService.rodarSeForAHora(new Date('2026-10-18T08:59:00Z'))).toBeNull();
    expect(fetchFalso).not.toHaveBeenCalled();

    // 06:00 — roda
    const agora = new Date('2026-10-18T09:00:00Z');
    expect(await custoResultadoService.rodarSeForAHora(agora)).toEqual({ farmaciasOk: 1, farmaciasErro: 0 });
    expect(fetchFalso).toHaveBeenCalledTimes(4);

    // mesmo dia, mais tarde — não repete
    expect(await custoResultadoService.rodarSeForAHora(new Date('2026-10-18T15:00:00Z'))).toBeNull();
    expect(fetchFalso).toHaveBeenCalledTimes(4);
  });

  it('gestor comum só vê as farmácias dele; sincronizar é só admin', async () => {
    const a = await criarGestor();
    const b = await criarGestor();
    const fa = await farmaciaComConta(a.id, 'act_a');
    const fb = await farmaciaComConta(b.id, 'act_b');
    vi.stubGlobal('fetch', vi.fn(async () => resposta({ data: [] })));
    await custoResultadoService.sincronizarTodas();

    const r = await api('GET', '/api/custo-resultado', { token: a.token });
    const ids = (r.body as { farmacias: Array<{ farmacia_id: number }> }).farmacias.map((x) => x.farmacia_id);
    expect(ids).toContain(fa.id);
    expect(ids).not.toContain(fb.id);

    expect((await api('GET', '/api/custo-resultado')).status).toBe(401);
    expect((await api('POST', '/api/custo-resultado/sincronizar', { token: a.token })).status).toBe(403);
  });
});
