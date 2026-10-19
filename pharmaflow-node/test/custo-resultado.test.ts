/**
 * Custo por resultado do Meta (7, 15 e 30 dias) — regras puras, job e rota.
 * O Meta NUNCA é chamado de verdade: o `fetch` global é substituído.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../src/database/db';
import { metaTokens, custoResultadoMeta, gestoresTrafego, farmacias } from '../src/database/schema';
import { encrypt } from '../src/cripto';
import { custoResultadoService } from '../src/composicao';
import { periodoDaJanela, resumirCampanhas, agoraBrasilia } from '../src/custo/calculo';
import { vincularContas } from '../src/custo/vinculo';
import { api, criarGestor, criarFarmacia, limparBanco } from './helpers';

// A chave do Fernet só existe no servidor; nos testes usamos uma fixa.
process.env.FARMACIAS_KEY = Buffer.alloc(32, 7).toString('base64url');

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

describe('Vínculo conta → farmácia pelo nome', () => {
  const f = (id: number, nome: string, nomeFachada: string | null = null) => ({ id, nome, nomeFachada });

  it('casa pela razão social ou pelo fantasia e junta CA01 e CA02 na mesma farmácia', () => {
    const r = vincularContas([
      { id: 'act_1', nome: 'CA01 - [FARMACIA RIBEIRA LTDA - Drogaria Max Ribeira]' },
      { id: 'act_2', nome: 'CA02- [E. G. FARMA LTDA - FARMACIA ECONOMIZE]' },
      { id: 'act_3', nome: 'CA01 - [E. G. FARMA LTDA - FARMACIA ECONOMIZE]' },
    ], [f(10, 'FARMACIA RIBEIRA LTDA'), f(20, 'E. G. FARMA', 'FARMACIA ECONOMIZE')]);

    expect(r.porFarmacia.get(10)).toEqual(['act_1']);
    expect(r.porFarmacia.get(20)).toEqual(['act_2', 'act_3']);
    expect(r.semFarmacia).toEqual([]);
  });

  it('palavra genérica sozinha não casa ("Drogaria Mais Saúde" ≠ qualquer conta com MAIS e SAUDE)', () => {
    const r = vincularContas(
      [{ id: 'act_1', nome: 'CA01 - [DROGARIA MAIS SAUDE POPULAR LTDA - Outra Coisa]' }],
      [f(1, 'MAIS SAUDE COMERCIO DE MEDICAMENTOS', 'Drogaria Mais Saúde')],
    );
    expect(r.porFarmacia.size).toBe(0);
    expect(r.semFarmacia.map((c) => c.id)).toEqual(['act_1']);
  });

  it('a chave tem que aparecer inteira na conta', () => {
    const r = vincularContas(
      [{ id: 'act_1', nome: 'CA01 - [ANDREIA TERESINHA LTDA - FARMÁCIA PREÇO BAIXO]' }],
      [f(1, 'FARMACIA PRECO BAIXO DE CACHOEIRO DE ITAPEMIRIM')],
    );
    expect(r.porFarmacia.size).toBe(0);
  });

  it('vence a farmácia com mais palavras casadas; empate fica de fora', () => {
    const conta = [{ id: 'act_1', nome: 'CA01 - [SILVA RIBEIRO LTDA - FARMACIA NOTURNA]' }];
    expect(vincularContas(conta, [f(1, 'SILVA'), f(2, 'SILVA RIBEIRO')]).porFarmacia.get(2)).toEqual(['act_1']);
    const empate = vincularContas(conta, [f(1, 'SILVA RIBEIRO'), f(2, 'Farmacia Noturna')]);
    expect(empate.porFarmacia.size).toBe(1);       // RIBEIRO+SILVA (2) vence NOTURNA (1)
    const ambigua = vincularContas(conta, [f(1, 'SILVA'), f(2, 'NOTURNA')]);
    expect(ambigua.porFarmacia.size).toBe(0);
    expect(ambigua.semFarmacia).toHaveLength(1);
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

  /** Gestor com o Facebook conectado (token próprio, criptografado, ainda válido). */
  async function gestorComToken(token = 'token-do-gestor', expiraEm: Date | null = null) {
    const g = await criarGestor();
    await db.update(gestoresTrafego)
      .set({ metaAccessToken: encrypt(token), metaTokenExpiraEm: expiraEm })
      .where(eq(gestoresTrafego.id, g.id));
    return g;
  }

  /** Farmácia com a conta cadastrada à mão (meta_tokens). */
  async function farmaciaComConta(gestorId: number, conta: string) {
    const f = await criarFarmacia(gestorId, { nomeFachada: 'Fachada de teste' });
    await db.insert(metaTokens).values({ farmaciaId: f.id, adAccountId: conta, pageId: 'p1' });
    return f;
  }

  /**
   * Meta simulado. `contas`: token → contas que ele enxerga em /me/adaccounts.
   * `insights` responde o /insights (recebe a conta e o token usados).
   */
  function simularMeta(
    contas: Record<string, Array<string | { id: string; nome: string }>>,
    insights: (conta: string, token: string, u: URL) => unknown = () => ({ data: [] }),
  ) {
    const chamadas: Array<{ conta: string; token: string; caminho: string }> = [];
    const fn = vi.fn(async (url: string) => {
      const u = new URL(String(url));
      const token = u.searchParams.get('access_token')!;
      expect(token).not.toBe('token-geral-de-teste');                       // nunca o geral
      if (u.pathname.endsWith('/me/adaccounts')) {
        return resposta({ data: (contas[token] ?? []).map((c) => {
          const { id, nome } = typeof c === 'string' ? { id: c, nome: c } : c;
          return { id, account_id: id.replace('act_', ''), name: nome, account_status: 1 };
        }) });
      }
      const conta = u.pathname.split('/')[2];
      chamadas.push({ conta, token, caminho: u.pathname });
      if (u.pathname.endsWith('/adsets')) return resposta(ADSETS);
      return resposta(insights(conta, token, u));
    });
    vi.stubGlobal('fetch', fn);
    return { fn, chamadas };
  }

  it('grava as 3 janelas e a rota devolve o custo por resultado', async () => {
    const gestor = await gestorComToken();
    const f = await farmaciaComConta(gestor.id, 'act_111');

    const periodosPedidos: string[] = [];
    const { chamadas } = simularMeta({ 'token-do-gestor': ['act_111'] }, (_c, _t, u) => {
      expect(u.searchParams.get('level')).toBe('campaign');
      periodosPedidos.push(u.searchParams.get('time_range')!);
      return { data: [
        { campaign_id: 'c1', spend: '200', clicks: '40', impressions: '900', actions: [{ action_type: WPP, value: '8' }] },
        // campanha de site: não pode entrar no custo
        { campaign_id: 'c-site', spend: '999', actions: [{ action_type: 'lead', value: '50' }] },
      ] };
    });

    const agora = new Date('2026-10-18T09:00:00Z');
    const resumo = await custoResultadoService.sincronizarTodas(agora);
    expect(resumo).toEqual({ farmaciasOk: 1, farmaciasErro: 0, semConta: 0, semFachada: 0 });
    expect(new Set(chamadas.map((c) => c.conta))).toEqual(new Set(['act_111']));
    expect(periodosPedidos.map((p) => JSON.parse(p).until)).toEqual(['2026-10-17', '2026-10-17', '2026-10-17']);

    const r = await api('GET', '/api/custo-resultado', { token: gestor.token });
    expect(r.status).toBe(200);
    const linha = (r.body as { farmacias: Array<Record<string, any>> }).farmacias.find((x) => x.farmacia_id === f.id)!;
    expect(linha.janela_7d.custo_por_resultado).toBe(25);
    expect(linha.janela_15d.resultados).toBe(8);
    expect(linha.janela_30d.periodo_inicio).toBe('2026-09-18');
    expect(linha.erro).toBeNull();
  });

  it('sem conta cadastrada: casa pelo nome e soma CA01 + CA02 da farmácia', async () => {
    const gestor = await gestorComToken();
    const ribeira = await criarFarmacia(gestor.id, { nome: 'FARMACIA RIBEIRA LTDA', nomeFachada: 'Drogaria Max Ribeira' });
    const outra   = await criarFarmacia(gestor.id, { nome: 'DROGARIA SEM CONTA NENHUMA', nomeFachada: 'Sem Conta' });

    simularMeta({ 'token-do-gestor': [
      { id: 'act_r1', nome: 'CA01 - [FARMACIA RIBEIRA LTDA - Drogaria Max Ribeira]' },
      { id: 'act_r2', nome: 'CA02 - [FARMACIA RIBEIRA LTDA - Drogaria Max Ribeira]' },
      { id: 'act_x',  nome: 'CA01 - [PHARMA CHATBOT]' },
    ] }, (conta) => ({ data: [
      { campaign_id: 'c1', spend: conta === 'act_r1' ? '100' : '50', actions: [{ action_type: WPP, value: '5' }] },
    ] }));

    const resumo = await custoResultadoService.sincronizarTodas();
    expect(resumo).toEqual({ farmaciasOk: 1, farmaciasErro: 0, semConta: 1, semFachada: 0 });

    const linhas = await db.select().from(custoResultadoMeta);
    expect(new Set(linhas.map((l) => l.farmaciaId))).toEqual(new Set([ribeira.id]));
    expect(linhas.map((l) => l.farmaciaId)).not.toContain(outra.id);
    const l7 = linhas.find((l) => l.janelaDias === 7)!;
    expect(l7.gasto).toBe('150.00');                 // 100 (CA01) + 50 (CA02)
    expect(l7.resultados).toBe(10);
    expect(l7.custoPorResultado).toBe('15.00');
  });

  it('uma conta com erro não derruba as outras e mantém o último número bom', async () => {
    const gestor = await gestorComToken();
    const boa  = await farmaciaComConta(gestor.id, 'act_ok');
    const ruim = await farmaciaComConta(gestor.id, 'act_ruim');

    let falhar = false;
    simularMeta({ 'token-do-gestor': ['act_ok', 'act_ruim'] }, (conta) => (conta === 'act_ruim' && falhar)
      ? { error: { message: 'sem permissão', code: 200 } }
      : { data: [{ campaign_id: 'c1', spend: '100', actions: [{ action_type: WPP, value: '4' }] }] });

    await custoResultadoService.sincronizarTodas();
    falhar = true;
    const resumo = await custoResultadoService.sincronizarTodas();
    expect(resumo).toEqual({ farmaciasOk: 1, farmaciasErro: 1, semConta: 0, semFachada: 0 });

    const [linha7] = await db.select().from(custoResultadoMeta)
      .where(eq(custoResultadoMeta.farmaciaId, ruim.id));
    expect(linha7.erro).toContain('sem permissão');
    expect(linha7.custoPorResultado).toBe('25.00');   // número da leitura anterior continua lá

    const [ok] = await db.select().from(custoResultadoMeta).where(eq(custoResultadoMeta.farmaciaId, boa.id));
    expect(ok.erro).toBeNull();
  });

  it('só roda a partir das 06:00 de Brasília e uma vez por dia', async () => {
    const gestor = await gestorComToken();
    await farmaciaComConta(gestor.id, 'act_222');
    // 1 listagem de contas + 1 de conjuntos + 3 de insights (7, 15 e 30 dias)
    const { fn } = simularMeta({ 'token-do-gestor': ['act_222'] });

    // 05:59 em Brasília (08:59 UTC) — ainda não
    expect(await custoResultadoService.rodarSeForAHora(new Date('2026-10-18T08:59:00Z'))).toBeNull();
    expect(fn).not.toHaveBeenCalled();

    // 06:00 — roda
    const agora = new Date('2026-10-18T09:00:00Z');
    expect(await custoResultadoService.rodarSeForAHora(agora)).toEqual({ farmaciasOk: 1, farmaciasErro: 0, semConta: 0, semFachada: 0 });
    expect(fn).toHaveBeenCalledTimes(5);

    // mesmo dia, mais tarde — não repete
    expect(await custoResultadoService.rodarSeForAHora(new Date('2026-10-18T15:00:00Z'))).toBeNull();
    expect(fn).toHaveBeenCalledTimes(5);
  });

  it('gestor comum só vê as farmácias dele; sincronizar é só admin', async () => {
    const a = await gestorComToken('token-a');
    const b = await gestorComToken('token-b');
    const fa = await farmaciaComConta(a.id, 'act_a');
    const fb = await farmaciaComConta(b.id, 'act_b');
    simularMeta({ 'token-a': ['act_a'], 'token-b': ['act_b'] });
    await custoResultadoService.sincronizarTodas();

    const r = await api('GET', '/api/custo-resultado', { token: a.token });
    const ids = (r.body as { farmacias: Array<{ farmacia_id: number }> }).farmacias.map((x) => x.farmacia_id);
    expect(ids).toContain(fa.id);
    expect(ids).not.toContain(fb.id);

    expect((await api('GET', '/api/custo-resultado')).status).toBe(401);
    expect((await api('POST', '/api/custo-resultado/sincronizar', { token: a.token })).status).toBe(403);
  });

  it('lê com o token do gestor da farmácia; se ele não conectou, com o de outro gestor que enxerga a conta', async () => {
    const joao    = await gestorComToken('token-joao');
    const mathews = await gestorComToken('token-mathews');
    const victor  = await criarGestor();                                   // nunca conectou o Facebook
    const doJoao   = await farmaciaComConta(joao.id, 'act_compartilhada');
    const doVictor = await farmaciaComConta(victor.id, 'act_do_victor');

    const { chamadas } = simularMeta({
      'token-joao':    ['act_compartilhada'],
      'token-mathews': ['act_compartilhada', 'act_do_victor'],
    });

    const resumo = await custoResultadoService.sincronizarTodas();
    expect(resumo).toEqual({ farmaciasOk: 2, farmaciasErro: 0, semConta: 0, semFachada: 0 });
    // conta que os dois enxergam: lida com o token do dono da farmácia
    expect(new Set(chamadas.filter((c) => c.conta === 'act_compartilhada').map((c) => c.token))).toEqual(new Set(['token-joao']));
    expect(new Set(chamadas.filter((c) => c.conta === 'act_do_victor').map((c) => c.token))).toEqual(new Set(['token-mathews']));

    const ids = new Set((await db.select().from(custoResultadoMeta)).map((r) => r.farmaciaId));
    expect(ids).toEqual(new Set([doJoao.id, doVictor.id]));
  });

  it('conta que nenhum token conectado enxerga não é lida (nem com o token geral) e a sobra antiga é apagada', async () => {
    const comToken = await gestorComToken();
    const vencido  = await gestorComToken('token-velho', new Date(Date.now() - 60_000));
    const f1 = await farmaciaComConta(comToken.id, 'act_com');
    const f2 = await farmaciaComConta(comToken.id, 'act_invisivel');
    const f3 = await farmaciaComConta(vencido.id,  'act_vencido');

    // sobra de uma leitura antiga da farmácia que agora ficou sem conta legível
    await db.insert(custoResultadoMeta).values({ farmaciaId: f2.id, janelaDias: 7, gasto: '10.00' });

    const { chamadas } = simularMeta({
      'token-do-gestor': ['act_com'],
      'token-velho':     ['act_vencido'],                                   // vencido: nem é consultado
    });

    const resumo = await custoResultadoService.sincronizarTodas();
    expect(resumo).toEqual({ farmaciasOk: 1, farmaciasErro: 0, semConta: 2, semFachada: 0 });
    expect(new Set(chamadas.map((c) => c.conta))).toEqual(new Set(['act_com']));

    const ids = (await db.select().from(custoResultadoMeta)).map((r) => r.farmaciaId);
    expect(new Set(ids)).toEqual(new Set([f1.id]));
    expect(ids).not.toContain(f2.id);
    expect(ids).not.toContain(f3.id);
  });

  it('farmácia sem nome de fachada não é lida nem aparece no painel até preencherem', async () => {
    const gestor = await gestorComToken();
    const semNada  = await criarFarmacia(gestor.id, { nome: 'FARMACIA RIBEIRA LTDA' });
    const emBranco = await criarFarmacia(gestor.id, { nome: 'DROGARIA AFRICA LTDA', nomeFachada: '   ' });
    // sobra de leitura antiga: tem que sumir
    await db.insert(custoResultadoMeta).values({ farmaciaId: semNada.id, janelaDias: 7, gasto: '10.00' });

    const { chamadas } = simularMeta({ 'token-do-gestor': [
      { id: 'act_r', nome: 'CA01 - [FARMACIA RIBEIRA LTDA - Drogaria Max Ribeira]' },
      { id: 'act_a', nome: 'CA01 - [DROGARIA AFRICA LTDA - DROGALENE]' },
    ] }, () => ({ data: [{ campaign_id: 'c1', spend: '30', actions: [{ action_type: WPP, value: '3' }] }] }));

    expect(await custoResultadoService.sincronizarTodas())
      .toEqual({ farmaciasOk: 0, farmaciasErro: 0, semConta: 0, semFachada: 2 });
    expect(chamadas).toHaveLength(0);                                     // nem foi ao Meta
    expect(await db.select().from(custoResultadoMeta)).toHaveLength(0);

    // preencheu a fachada: na rodada seguinte aparece
    await db.update(farmacias).set({ nomeFachada: 'Drogaria Max Ribeira' }).where(eq(farmacias.id, semNada.id));
    expect((await custoResultadoService.sincronizarTodas()).farmaciasOk).toBe(1);
    const lista = async () => ((await api('GET', '/api/custo-resultado', { token: gestor.token })).body as {
      farmacias: Array<{ farmacia_id: number }> }).farmacias.map((x) => x.farmacia_id);
    expect(await lista()).toEqual([semNada.id]);
    expect(await lista()).not.toContain(emBranco.id);

    // apagou a fachada: some do painel na hora, sem esperar o job
    await db.update(farmacias).set({ nomeFachada: null }).where(eq(farmacias.id, semNada.id));
    expect(await lista()).toEqual([]);
  });
});
