/**
 * Pausar UM produto de uma campanha sem cancelá-la (migration 0047).
 *
 * Pedido do dono (23/11/2026): produto que acabou o estoque ou mudou de preço
 * no meio da campanha. Antes, a única saída era cancelar tudo e montar de novo.
 *
 * A Evolution é simulada — nenhuma mensagem real sai.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { api, criarGestor, conectarWhatsappFake, limparBanco } from './helpers';
import { db } from '../src/database/db';
import { disparosGrupo, type DisparoGrupo } from '../src/database/schema';
import { disparoService } from '../src/composicao';
import { fatiarRodizio, loteDaVez, listaAcabou, PRODUTOS_POR_ENVIO } from '../src/disparos/rodizio';
import { motivoParaNaoPausar, motivoParaNaoReativar, type SituacaoDaCampanha } from '../src/disparos/pausa';
import type { MidiaDisparo } from '../src/disparos/types';

const GRUPO = { jid: '55119999@g.us', nome: 'Grupo de Ofertas' };

/** Lista de N criativos fake, com rótulo numerado para conferir a ordem. */
const listaDe = (n: number): MidiaDisparo[] =>
  Array.from({ length: n }, (_, i) => ({ b64: 'ZmFrZQ==', mime: 'image/png', rotulo: `p${i}` }));

const rotulos = (m: MidiaDisparo[]) => m.map((x) => x.rotulo);

/** Só os campos que o rodízio lê — o resto do registro não importa aqui. */
const disparoFake = (campos: Partial<DisparoGrupo>): DisparoGrupo => ({
  repetir: 'diario', repetirProdutos: false, cursorMidia: 0,
  midiasPausadas: [], midiasPuladas: [], midiasJson: null,
  ...campos,
}) as DisparoGrupo;

// ── Regra pura: o rodízio respeita a pausa ───────────────────────────────────

describe('Rodízio com produto pausado (regra)', () => {
  it('pula o pausado e anota que ele ficou devendo', () => {
    const r = fatiarRodizio(listaDe(9), 0, 3, false, { pausadas: [1], puladas: [] });

    expect(rotulos(r.lote)).toEqual(['p0', 'p2', 'p3']);
    expect(r.proximoCursor).toBe(4);
    expect(r.puladas).toEqual([1]);
    expect(r.acabou).toBe(false);
  });

  it('pausado que ainda não chegou a vez não é anotado', () => {
    const r = fatiarRodizio(listaDe(9), 0, 3, false, { pausadas: [7], puladas: [] });

    expect(rotulos(r.lote)).toEqual(['p0', 'p1', 'p2']);
    expect(r.puladas).toEqual([]);
  });

  it('reativado depois de perder a vez sai na postagem seguinte, antes da fila', () => {
    // p1 foi pulado na 1ª postagem e o gestor reativou: pausadas vazio
    const r = fatiarRodizio(listaDe(9), 4, 3, false, { pausadas: [], puladas: [1] });

    expect(rotulos(r.lote)).toEqual(['p1', 'p4', 'p5']);
    expect(r.proximoCursor).toBe(6);
    expect(r.puladas).toEqual([]);
  });

  it('continua pausado = continua devendo, sem travar a fila', () => {
    const r = fatiarRodizio(listaDe(9), 4, 3, false, { pausadas: [1], puladas: [1] });

    expect(rotulos(r.lote)).toEqual(['p4', 'p5', 'p6']);
    expect(r.puladas).toEqual([1]);
  });

  it('sem volta: a lista NÃO acaba enquanto houver produto pausado devendo', () => {
    const r = fatiarRodizio(listaDe(6), 3, 3, false, { pausadas: [1], puladas: [1] });

    expect(rotulos(r.lote)).toEqual(['p3', 'p4', 'p5']);
    expect(r.proximoCursor).toBe(6);
    expect(r.acabou).toBe(false);       // p1 não foi ao ar

    // Só sobrou o pausado: postagem vazia, campanha esperando
    const espera = fatiarRodizio(listaDe(6), 6, 3, false, { pausadas: [1], puladas: [1] });
    expect(espera.lote).toEqual([]);
    expect(espera.acabou).toBe(false);

    // Reativado: sai e aí sim a lista acaba
    const fim = fatiarRodizio(listaDe(6), 6, 3, false, { pausadas: [], puladas: [1] });
    expect(rotulos(fim.lote)).toEqual(['p1']);
    expect(fim.acabou).toBe(true);
  });

  it('cobre a lista inteira com uma pausa no meio do caminho, sem repetir nada', () => {
    const lista = listaDe(10);
    const vistos: string[] = [];
    let cursor = 0;
    let puladas: number[] = [];
    let pausadas = [4];

    for (let postagem = 0; postagem < 20; postagem++) {
      // Na 3ª postagem o estoque voltou
      if (postagem === 2) pausadas = [];
      const r = fatiarRodizio(lista, cursor, 3, false, { pausadas, puladas });
      r.lote.forEach((m) => vistos.push(m.rotulo!));
      cursor = r.proximoCursor;
      puladas = r.puladas;
      if (r.acabou) break;
    }

    expect([...vistos].sort()).toEqual([...rotulos(lista)].sort() as string[]);
    expect(new Set(vistos).size).toBe(10);
  });

  it('com volta: fechar a volta zera quem estava devendo', () => {
    const r = fatiarRodizio(listaDe(6), 3, 3, true, { pausadas: [1], puladas: [1] });

    expect(rotulos(r.lote)).toEqual(['p3', 'p4', 'p5']);
    expect(r.proximoCursor).toBe(0);
    expect(r.puladas).toEqual([]);      // na volta nova o p1 tem a vez dele de novo
    expect(r.acabou).toBe(false);
  });

  it('com volta: fim da lista todo pausado não vira postagem vazia — começa a volta nova', () => {
    const r = fatiarRodizio(listaDe(6), 4, 3, true, { pausadas: [4, 5], puladas: [] });

    expect(rotulos(r.lote)).toEqual(['p0', 'p1', 'p2']);
    expect(r.proximoCursor).toBe(3);
    expect(r.acabou).toBe(false);
  });

  it('com volta e tudo pausado: postagem vazia, nunca encerra por isso', () => {
    const r = fatiarRodizio(listaDe(3), 0, 3, true, { pausadas: [0, 1, 2], puladas: [] });
    expect(r.lote).toEqual([]);
    expect(r.acabou).toBe(false);
  });

  it('sem pausa nenhuma, o comportamento é o de antes', () => {
    const antes = fatiarRodizio(listaDe(20), 18);
    expect(rotulos(antes.lote)).toEqual(['p18', 'p19']);
    expect(antes.acabou).toBe(true);
    expect(antes.puladas).toEqual([]);
    expect(fatiarRodizio(listaDe(5), 0, PRODUTOS_POR_ENVIO).proximoCursor).toBe(3);
  });

  it('coluna suja (índice fora da lista, repetido) não quebra', () => {
    const r = fatiarRodizio(listaDe(4), 0, 3, false, { pausadas: [9, -1, 1, 1], puladas: [7] });
    expect(rotulos(r.lote)).toEqual(['p0', 'p2', 'p3']);
    expect(r.puladas).toEqual([1]);
  });

  it('envio único: o pausado fica de fora e é anotado como não enviado', () => {
    const d = disparoFake({ repetir: 'nunca', midiasPausadas: [2] });
    const r = loteDaVez(d, listaDe(5));

    expect(rotulos(r.lote)).toEqual(['p0', 'p1', 'p3', 'p4']);
    expect(r.puladas).toEqual([2]);
    expect(r.acabou).toBe(true);
  });

  it('listaAcabou (callback do motor) enxerga quem está devendo', () => {
    const midiasJson = JSON.stringify(listaDe(6));
    expect(listaAcabou(disparoFake({ midiasJson, cursorMidia: 6, midiasPuladas: [] }))).toBe(true);
    expect(listaAcabou(disparoFake({ midiasJson, cursorMidia: 6, midiasPuladas: [1] }))).toBe(false);
    // Envio único não tem "depois": o que ficou de fora, ficou
    expect(listaAcabou(disparoFake({ midiasJson, cursorMidia: 6, midiasPuladas: [1], repetir: 'nunca' }))).toBe(true);
  });
});

// ── Regra pura: quando pode pausar ───────────────────────────────────────────

describe('Quando o produto pode ser pausado (regra)', () => {
  const campanha = (c: Partial<SituacaoDaCampanha>): SituacaoDaCampanha => ({
    status: 'agendado', repetir: 'diario', repetirProdutos: false,
    cursorMidia: 0, totalMidias: 6, midiasPausadas: [], midiasPuladas: [],
    ...c,
  });

  it('campanha agendada: pode', () => {
    expect(motivoParaNaoPausar(campanha({}), 2)).toBeNull();
  });

  it('campanha encerrada ou cancelada: não pode pausar nem reativar', () => {
    for (const status of ['enviado', 'cancelado', 'erro']) {
      expect(motivoParaNaoPausar(campanha({ status }), 2)).toMatch(/terminou/);
      expect(motivoParaNaoReativar(campanha({ status }))).toMatch(/terminou/);
    }
  });

  it('sem volta: produto que já foi postado não tem o que pausar', () => {
    expect(motivoParaNaoPausar(campanha({ cursorMidia: 3 }), 1)).toMatch(/já foi postado/);
    // ...mas o que foi PULADO (estava pausado) ainda não saiu
    expect(motivoParaNaoPausar(campanha({ cursorMidia: 3, midiasPuladas: [1] }), 1)).toBeNull();
  });

  it('com volta: produto já postado sai de novo na próxima volta, então pode pausar', () => {
    expect(motivoParaNaoPausar(campanha({ cursorMidia: 3, repetirProdutos: true }), 1)).toBeNull();
  });

  it('envio único: não deixa pausar o último produto ativo', () => {
    const unico = campanha({ repetir: 'nunca', totalMidias: 2, midiasPausadas: [0] });
    expect(motivoParaNaoPausar(unico, 1)).toMatch(/único produto ativo/);
    // Pausar de novo o que já está pausado não é "tirar o último"
    expect(motivoParaNaoPausar(unico, 0)).toBeNull();
  });

  it('envio único já saindo: não mexe mais', () => {
    const saindo = campanha({ repetir: 'nunca', status: 'enviando' });
    expect(motivoParaNaoPausar(saindo, 1)).toMatch(/saindo/);
    expect(motivoParaNaoReativar(saindo)).toMatch(/saindo/);
  });

  it('campanha repetida saindo agora: a pausa vale para a próxima postagem', () => {
    expect(motivoParaNaoPausar(campanha({ status: 'enviando' }), 4)).toBeNull();
  });

  it('envio único: índice pausado fora da lista (coluna suja) não conta como produto pausado', () => {
    // 3 produtos, só o 0 pausado de verdade — o 9 não existe. Pausar o 1
    // ainda deixa o 2 ativo, então tem que poder.
    const unico = campanha({ repetir: 'nunca', totalMidias: 3, midiasPausadas: [0, 9] });
    expect(motivoParaNaoPausar(unico, 1)).toBeNull();
  });
});

// ── Pela API ─────────────────────────────────────────────────────────────────

/** Evolution falsa que guarda a legenda de cada imagem enviada. */
function simularEvolution(): { legendas: string[]; textos: number } {
  const registro = { legendas: [] as string[], textos: 0 };

  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string }) => {
    const u = String(url);
    if (u.includes('/instance/connectionState/')) {
      return new Response(JSON.stringify({ instance: { state: 'open' } }), { status: 200 });
    }
    if (u.includes('/message/sendMedia')) {
      const corpo = JSON.parse(String(init?.body ?? '{}'));
      // A legenda é "mensagem\n\nrótulo" — guardamos só o rótulo
      registro.legendas.push(String(corpo.caption ?? '').split('\n').pop()!);
      return new Response(JSON.stringify({ key: { id: 'MSG' } }), { status: 200 });
    }
    if (u.includes('/message/sendText')) {
      registro.textos += 1;
      return new Response(JSON.stringify({ key: { id: 'MSG' } }), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  }));

  return registro;
}

/** Campanha agendada para daqui a uma hora (fim de semana liberado, para o teste não depender do dia). */
async function agendar(token: string, extra: Record<string, unknown> = {}) {
  const r = await api('POST', '/api/disparos', {
    token,
    body: {
      titulo: 'Ofertas', mensagem: 'Promoção', midias: listaDe(6),
      grupos: [GRUPO], quando: 'agendado', repetir: 'diario',
      agendado_para: new Date(Date.now() + 3600_000).toISOString(),
      permitir_fim_de_semana: true,
      ...extra,
    },
  });
  expect(r.status).toBe(201);
  return r.body.id as number;
}

const pausar = (token: string, id: number, indice: number, pausado = true) =>
  api('PATCH', `/api/disparos/${id}/produtos/${indice}`, { token, body: { pausado } });

describe('Pausar produto pela API', () => {
  beforeEach(limparBanco);
  afterEach(() => { vi.unstubAllGlobals(); });

  it('pausa e reativa; o acompanhamento e a lista mostram', async () => {
    const g = await criarGestor();
    await conectarWhatsappFake(g.id);
    const id = await agendar(g.token);

    const r = await pausar(g.token, id, 2);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ indice: 2, rotulo: 'p2', pausado: true, produtos_pausados: [2] });

    // Idempotente: pausar de novo não duplica
    expect((await pausar(g.token, id, 2)).body).toMatchObject({ produtos_pausados: [2] });

    const detalhe = await api('GET', `/api/disparos/${id}`, { token: g.token });
    expect(detalhe.body).toMatchObject({ produtos_pausados: [2], produtos_pulados: [] });

    const lista = await api('GET', '/api/disparos', { token: g.token });
    expect(lista.body[0]).toMatchObject({ id, total_midias: 6, total_pausados: 1 });

    const volta = await pausar(g.token, id, 2, false);
    expect(volta.body).toMatchObject({ pausado: false, produtos_pausados: [] });
  });

  it('outro gestor não pausa; o admin pausa', async () => {
    const a = await criarGestor();
    const b = await criarGestor();
    const admin = await criarGestor({ isAdmin: true });
    await conectarWhatsappFake(a.id);
    const id = await agendar(a.token);

    expect((await pausar(b.token, id, 0)).status).toBe(403);
    expect((await pausar(admin.token, id, 0)).status).toBe(200);
  });

  it('recusa índice fora da lista, corpo sem "pausado" e campanha cancelada', async () => {
    const g = await criarGestor();
    await conectarWhatsappFake(g.id);
    const id = await agendar(g.token);

    expect((await pausar(g.token, id, 6)).status).toBe(404);
    expect((await api('PATCH', `/api/disparos/${id}/produtos/0`, { token: g.token, body: {} })).status).toBe(400);

    await api('DELETE', `/api/disparos/${id}`, { token: g.token });
    expect((await pausar(g.token, id, 0)).status).toBe(409);
  });

  it('envio único: não deixa pausar o último produto ativo', async () => {
    const g = await criarGestor();
    await conectarWhatsappFake(g.id);
    const id = await agendar(g.token, { repetir: 'nunca', midias: listaDe(2) });

    expect((await pausar(g.token, id, 0)).status).toBe(200);
    const ultimo = await pausar(g.token, id, 1);
    expect(ultimo.status).toBe(409);
    expect(ultimo.body.detail).toMatch(/cancele/);
  });

  it('no envio, o pausado não sai; reativado, sai na postagem seguinte', async () => {
    const g = await criarGestor();
    await conectarWhatsappFake(g.id);
    const id = await agendar(g.token);
    const evo = simularEvolution();

    await pausar(g.token, id, 1);

    await disparoService.executarDisparo(id);
    expect(evo.legendas).toEqual(['p0', 'p2', 'p3']);

    const [depois] = await db.select().from(disparosGrupo).where(eq(disparosGrupo.id, id));
    expect(depois.status).toBe('agendado');
    expect(depois.cursorMidia).toBe(4);
    expect(depois.midiasPuladas).toEqual([1]);

    // O estoque voltou
    await pausar(g.token, id, 1, false);
    evo.legendas.length = 0;

    await disparoService.executarDisparo(id);
    expect(evo.legendas).toEqual(['p1', 'p4', 'p5']);

    // E agora sim a lista acabou
    const [fim] = await db.select().from(disparosGrupo).where(eq(disparosGrupo.id, id));
    expect(fim.status).toBe('enviado');
    expect(fim.midiasPuladas).toEqual([]);
  });

  it('todos os da vez pausados: nada vai para o grupo — nem a mensagem solta', async () => {
    const g = await criarGestor();
    await conectarWhatsappFake(g.id);
    const id = await agendar(g.token, { midias: listaDe(2) });
    const evo = simularEvolution();

    await pausar(g.token, id, 0);
    await pausar(g.token, id, 1);

    await disparoService.executarDisparo(id);
    expect(evo.legendas).toEqual([]);
    expect(evo.textos).toBe(0);

    // A campanha segue viva, esperando o gestor reativar
    const [d] = await db.select().from(disparosGrupo).where(eq(disparosGrupo.id, id));
    expect(d.status).toBe('agendado');
    expect(d.proximoEnvio).not.toBeNull();
    expect(d.ultimoEnvio).toBeNull();
  });

  it('envio único: sai tudo menos o pausado, e o acompanhamento diz que ele não saiu', async () => {
    const g = await criarGestor();
    await conectarWhatsappFake(g.id);
    const id = await agendar(g.token, { repetir: 'nunca', midias: listaDe(4) });
    const evo = simularEvolution();

    await pausar(g.token, id, 3);
    await disparoService.executarDisparo(id);

    expect(evo.legendas).toEqual(['p0', 'p1', 'p2']);
    const detalhe = await api('GET', `/api/disparos/${id}`, { token: g.token });
    expect(detalhe.body).toMatchObject({ status: 'enviado', produtos_pulados: [3] });
  });
});

// ── Bateria 2 (24/11/2026): motor de campanhas, bordas da API, fim de campanha ─

/** Lê o disparo direto do banco — é a fonte da verdade do envio. */
async function doBanco(id: number) {
  const [d] = await db.select().from(disparosGrupo).where(eq(disparosGrupo.id, id));
  return d;
}

/**
 * Motor de campanhas falso (CAMPAIGNS_API_URL, o caminho de PRODUÇÃO). Guarda
 * o rótulo de cada criativo que o PharmaFlow mandou enfileirar.
 */
function simularMotor(aceita = true): { chamadas: number; rotulos: string[][] } {
  const registro = { chamadas: 0, rotulos: [] as string[][] };
  vi.stubEnv('CAMPAIGNS_API_URL', 'http://motor.teste');

  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string }) => {
    const u = String(url);
    if (u.startsWith('http://motor.teste/disparo')) {
      registro.chamadas += 1;
      const corpo = JSON.parse(String(init?.body ?? '{}'));
      registro.rotulos.push(
        (corpo.medias ?? []).map((m: { rotulo?: string }) => String(m.rotulo ?? '').split('\n').pop()),
      );
      return aceita
        ? new Response(JSON.stringify({ ok: true }), { status: 202 })
        : new Response(JSON.stringify({ erro: 'fila cheia' }), { status: 500 });
    }
    if (u.includes('/instance/connectionState/')) {
      return new Response(JSON.stringify({ instance: { state: 'open' } }), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  }));

  return registro;
}

describe('Pausa no motor de campanhas (caminho de produção)', () => {
  beforeEach(limparBanco);
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it('o motor recebe só os produtos ativos, e o pulado fica anotado', async () => {
    const g = await criarGestor();
    await conectarWhatsappFake(g.id);
    const id = await agendar(g.token);
    const motor = simularMotor();

    await pausar(g.token, id, 1);
    const r = await disparoService.executarDisparo(id);

    expect(r).toEqual({ modo: 'campanhas', grupos: 1 });
    expect(motor.rotulos).toEqual([['p0', 'p2', 'p3']]);
    const d = await doBanco(id);
    expect(d.cursorMidia).toBe(4);
    expect(d.midiasPuladas).toEqual([1]);
  });

  it('motor recusou: nem o cursor nem os pulados andam (nada foi consumido)', async () => {
    const g = await criarGestor();
    await conectarWhatsappFake(g.id);
    const id = await agendar(g.token);
    simularMotor(false);

    await pausar(g.token, id, 1);
    await expect(disparoService.executarDisparo(id)).rejects.toThrow(/recusou/);

    const d = await doBanco(id);
    expect(d.status).toBe('erro');
    expect(d.cursorMidia).toBe(0);
    expect(d.midiasPuladas).toEqual([]);
  });

  it('callback do motor não encerra a campanha enquanto há pausado devendo', async () => {
    const g = await criarGestor();
    await conectarWhatsappFake(g.id);
    const id = await agendar(g.token, { midias: listaDe(3) });
    simularMotor();

    await pausar(g.token, id, 1);
    await disparoService.executarDisparo(id);          // sai p0 e p2; cursor no fim
    await disparoService.finalizarDisparo(id, [{ jid: GRUPO.jid, nome: GRUPO.nome, status: 'ok' }]);

    const d = await doBanco(id);
    expect(d.status).toBe('agendado');                 // p1 ainda não foi ao ar
    expect(d.proximoEnvio).not.toBeNull();
  });

  it('tudo pausado: o motor nem é chamado', async () => {
    const g = await criarGestor();
    await conectarWhatsappFake(g.id);
    const id = await agendar(g.token, { midias: listaDe(2) });
    const motor = simularMotor();

    await pausar(g.token, id, 0);
    await pausar(g.token, id, 1);
    await disparoService.executarDisparo(id);

    expect(motor.chamadas).toBe(0);
    expect((await doBanco(id)).status).toBe('agendado');
  });
});

describe('Pausa pela API — bordas', () => {
  beforeEach(limparBanco);
  afterEach(() => { vi.unstubAllGlobals(); });

  it('sem login: 401', async () => {
    const r = await api('PATCH', '/api/disparos/1/produtos/0', { body: { pausado: true } });
    expect(r.status).toBe(401);
  });

  it('disparo que não existe: 404', async () => {
    const g = await criarGestor();
    expect((await pausar(g.token, 999, 0)).status).toBe(404);
  });

  it('índice que não é inteiro positivo: 400', async () => {
    const g = await criarGestor();
    await conectarWhatsappFake(g.id);
    const id = await agendar(g.token);

    for (const indice of ['abc', '-1', '1.5']) {
      const r = await api('PATCH', `/api/disparos/${id}/produtos/${indice}`, { token: g.token, body: { pausado: true } });
      expect(r.status, `índice "${indice}"`).toBe(400);
    }
  });

  it('"pausado" tem que ser booleano de verdade — o texto "true" não vale', async () => {
    const g = await criarGestor();
    await conectarWhatsappFake(g.id);
    const id = await agendar(g.token);

    const r = await api('PATCH', `/api/disparos/${id}/produtos/0`, { token: g.token, body: { pausado: 'true' } });
    expect(r.status).toBe(400);
    expect((await doBanco(id)).midiasPausadas).toEqual([]);
  });

  it('disparo só de texto não tem produto para pausar: 404', async () => {
    const g = await criarGestor();
    await conectarWhatsappFake(g.id);
    const id = await agendar(g.token, { midias: [] });
    expect((await pausar(g.token, id, 0)).status).toBe(404);
  });

  it('arte pronta (sem rótulo) pausa e devolve rótulo null', async () => {
    const g = await criarGestor();
    await conectarWhatsappFake(g.id);
    const id = await agendar(g.token, { midias: [{ b64: 'ZmFrZQ==', mime: 'image/png' }, ...listaDe(2)] });

    const r = await pausar(g.token, id, 0);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ indice: 0, rotulo: null, pausado: true });
  });

  it('reativar o que não está pausado não quebra nada', async () => {
    const g = await criarGestor();
    await conectarWhatsappFake(g.id);
    const id = await agendar(g.token);
    await pausar(g.token, id, 4);

    const r = await pausar(g.token, id, 2, false);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ produtos_pausados: [4] });
  });

  it('campanha que já terminou: 409', async () => {
    const g = await criarGestor();
    await conectarWhatsappFake(g.id);
    const id = await agendar(g.token);
    await db.update(disparosGrupo).set({ status: 'enviado' }).where(eq(disparosGrupo.id, id));

    const r = await pausar(g.token, id, 0);
    expect(r.status).toBe(409);
    expect((r.body as { detail: string }).detail).toMatch(/terminou/);
  });

  it('sem volta: produto que já foi postado não pode ser pausado (409)', async () => {
    const g = await criarGestor();
    await conectarWhatsappFake(g.id);
    const id = await agendar(g.token);
    await db.update(disparosGrupo).set({ cursorMidia: 3 }).where(eq(disparosGrupo.id, id));

    expect((await pausar(g.token, id, 0)).status).toBe(409);
    expect((await pausar(g.token, id, 3)).status).toBe(200);   // o próximo da fila pode
  });

  it('saindo agora: campanha repetida aceita (vale para a próxima); envio único recusa', async () => {
    const g = await criarGestor();
    await conectarWhatsappFake(g.id);
    const repetida = await agendar(g.token);
    const unica = await agendar(g.token, { repetir: 'nunca' });
    await db.update(disparosGrupo).set({ status: 'enviando' }).where(eq(disparosGrupo.id, repetida));
    await db.update(disparosGrupo).set({ status: 'enviando' }).where(eq(disparosGrupo.id, unica));

    expect((await pausar(g.token, repetida, 4)).status).toBe(200);
    expect((await pausar(g.token, unica, 4)).status).toBe(409);
  });

  it('pausar NÃO mexe em atualizado_em (é por ele que se acha disparo travado)', async () => {
    const g = await criarGestor();
    await conectarWhatsappFake(g.id);
    const id = await agendar(g.token);
    const antigo = new Date('2026-01-01T12:00:00Z');
    await db.update(disparosGrupo).set({ atualizadoEm: antigo }).where(eq(disparosGrupo.id, id));

    await pausar(g.token, id, 2);
    await pausar(g.token, id, 2, false);

    expect((await doBanco(id)).atualizadoEm?.toISOString()).toBe(antigo.toISOString());
  });

  it('cinco pausas ao mesmo tempo (duas abas, cliques rápidos): nenhuma se perde', async () => {
    const g = await criarGestor();
    await conectarWhatsappFake(g.id);
    const id = await agendar(g.token);

    const respostas = await Promise.all([0, 1, 2, 3, 4].map((i) => pausar(g.token, id, i)));
    expect(respostas.every((r) => r.status === 200)).toBe(true);
    expect([...(await doBanco(id)).midiasPausadas].sort()).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('Fim de campanha com produto pausado', () => {
  beforeEach(limparBanco);
  afterEach(() => { vi.unstubAllGlobals(); });

  /** Término 10 min depois do 1º envio: a próxima ocorrência diária já passa dele. */
  const terminoCurto = () => ({
    repetir_ate: new Date(Date.now() + 3600_000 + 10 * 60_000).toISOString(),
  });

  it('chegou o término e só sobrou pausado: encerra como ENVIADO (ela postou antes)', async () => {
    const g = await criarGestor();
    await conectarWhatsappFake(g.id);
    const id = await agendar(g.token, terminoCurto());
    const evo = simularEvolution();
    await db.update(disparosGrupo).set({
      cursorMidia: 6, midiasPausadas: [1], midiasPuladas: [1],
      ultimoEnvio: new Date(Date.now() - 864e5),
    }).where(eq(disparosGrupo.id, id));

    await disparoService.executarDisparo(id);

    expect(evo.legendas).toEqual([]);
    const d = await doBanco(id);
    expect(d.status).toBe('enviado');
    expect(d.proximoEnvio).toBeNull();
  });

  it('envio único que ficou sem produto (corrida de cliques): nada sai e vira ERRO', async () => {
    const g = await criarGestor();
    await conectarWhatsappFake(g.id);
    const id = await agendar(g.token, { repetir: 'nunca', midias: listaDe(2) });
    const evo = simularEvolution();
    // A API não deixa chegar aqui; simula duas abas pausando ao mesmo tempo
    await db.update(disparosGrupo).set({ midiasPausadas: [0, 1] }).where(eq(disparosGrupo.id, id));

    await disparoService.executarDisparo(id);

    expect(evo.legendas).toEqual([]);
    expect(evo.textos).toBe(0);
    expect((await doBanco(id)).status).toBe('erro');
  });

  it('lista que dá a volta: o fim pausado não gera postagem vazia, e o reativado volta na vez dele', async () => {
    const g = await criarGestor();
    await conectarWhatsappFake(g.id);
    const id = await agendar(g.token, {
      midias: listaDe(4), repetir_produtos: true,
      repetir_ate: new Date(Date.now() + 30 * 864e5).toISOString(),
    });
    const evo = simularEvolution();

    await pausar(g.token, id, 3);

    await disparoService.executarDisparo(id);
    expect(evo.legendas).toEqual(['p0', 'p1', 'p2']);

    // Só o p3 (pausado) até o fim: começa a volta nova na mesma postagem
    evo.legendas.length = 0;
    await disparoService.executarDisparo(id);
    expect(evo.legendas).toEqual(['p0', 'p1', 'p2']);

    // Reativado: sai na vez dele e a lista recomeça
    await pausar(g.token, id, 3, false);
    evo.legendas.length = 0;
    await disparoService.executarDisparo(id);
    expect(evo.legendas).toEqual(['p3']);
    const d = await doBanco(id);
    expect(d.cursorMidia).toBe(0);
    expect(d.status).toBe('agendado');
  });
});
