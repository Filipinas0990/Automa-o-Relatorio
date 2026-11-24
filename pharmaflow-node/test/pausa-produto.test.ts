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
