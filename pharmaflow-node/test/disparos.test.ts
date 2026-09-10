/**
 * Disparo em grupos: conexão do gestor, validações e isolamento.
 *
 * A Evolution NUNCA é chamada de verdade aqui — a URL de teste aponta para um
 * host inexistente e, onde precisamos simular envio, o `fetch` é substituído.
 * Nenhuma mensagem real sai durante os testes.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  api, criarGestor, criarFarmacia, criarSolicitacao,
  conectarWhatsappFake, limparBanco,
} from './helpers';
import { fatiarRodizio } from '../src/disparos/service';
import type { MidiaDisparo } from '../src/disparos/service';

const GRUPO = { jid: '55119999@g.us', nome: 'Grupo de Ofertas' };
const MIDIA = { b64: 'ZmFrZQ==', mime: 'image/png', rotulo: 'Dipirona — R$ 9,90' };

/**
 * Evolution falsa. Antes de disparar, a API confere o estado da conexão ao vivo
 * — então o mock precisa responder 'open' em /instance/connectionState, senão
 * o disparo é (corretamente) recusado com 409.
 *
 * @param envioOk  false simula a Evolution recusando as mensagens
 * @returns a lista de URLs chamadas, para inspeção no teste
 */
function simularEvolution(envioOk = true): string[] {
  const chamadas: string[] = [];

  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url);
    chamadas.push(u);

    if (u.includes('/instance/connectionState/')) {
      return new Response(JSON.stringify({ instance: { state: 'open' } }), { status: 200 });
    }
    if (u.includes('/message/send')) {
      return envioOk
        ? new Response(JSON.stringify({ key: { id: 'MSG1' } }), { status: 200 })
        : new Response(JSON.stringify({ error: 'instance not connected' }), { status: 400 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  }));

  return chamadas;
}

describe('Conexão de WhatsApp do gestor', () => {
  beforeEach(limparBanco);

  it('cada gestor tem a própria conexão, e ela começa desconectada', async () => {
    const a = await criarGestor();
    const b = await criarGestor();

    const statusA = await api('GET', '/api/disparos/whatsapp/status', { token: a.token });
    const statusB = await api('GET', '/api/disparos/whatsapp/status', { token: b.token });

    expect(statusA.body.conectado).toBe(false);
    expect(statusB.body.conectado).toBe(false);
    expect(statusA.body.instancia).toBeNull();
  });

  it('a conexão de um gestor não aparece para o outro', async () => {
    const a = await criarGestor();
    const b = await criarGestor();
    await conectarWhatsappFake(a.id);

    const statusA = await api('GET', '/api/disparos/whatsapp/status', { token: a.token });
    const statusB = await api('GET', '/api/disparos/whatsapp/status', { token: b.token });

    expect(statusA.body.instancia).toBe(`gestor_${a.id}`);
    expect(statusB.body.instancia).toBeNull();
  });

  it('exige autenticação', async () => {
    expect((await api('GET', '/api/disparos/whatsapp/status')).status).toBe(401);
    expect((await api('GET', '/api/disparos/grupos')).status).toBe(401);
    expect((await api('GET', '/api/disparos')).status).toBe(401);
  });

  it('sem conexão, a lista de grupos vem vazia em vez de estourar', async () => {
    const g = await criarGestor();
    const r = await api('GET', '/api/disparos/grupos', { token: g.token });
    expect(r.status).toBe(200);
    expect(r.body).toEqual([]);
  });
});

describe('Validações do disparo', () => {
  beforeEach(limparBanco);

  it('recusa disparo quando o WhatsApp não está conectado', async () => {
    const g = await criarGestor();
    const r = await api('POST', '/api/disparos', {
      token: g.token,
      body: { titulo: 'Ofertas', mensagem: 'oi', grupos: [GRUPO], quando: 'agora' },
    });
    expect(r.status).toBe(409);
  });

  it('recusa disparo sem nenhum grupo', async () => {
    const g = await criarGestor();
    await conectarWhatsappFake(g.id);

    const r = await api('POST', '/api/disparos', {
      token: g.token,
      body: { titulo: 'Ofertas', mensagem: 'oi', grupos: [], quando: 'agora' },
    });
    expect(r.status).toBe(400);
  });

  it('recusa disparo sem mensagem e sem criativo', async () => {
    const g = await criarGestor();
    await conectarWhatsappFake(g.id);

    const r = await api('POST', '/api/disparos', {
      token: g.token,
      body: { titulo: 'Ofertas', mensagem: '   ', midias: [], grupos: [GRUPO], quando: 'agora' },
    });
    expect(r.status).toBe(400);
  });

  it('recusa agendamento sem data', async () => {
    const g = await criarGestor();
    await conectarWhatsappFake(g.id);

    const r = await api('POST', '/api/disparos', {
      token: g.token,
      body: { titulo: 'Ofertas', mensagem: 'oi', grupos: [GRUPO], quando: 'agendado' },
    });
    expect(r.status).toBe(400);
  });

  it('recusa agendamento com data inválida', async () => {
    const g = await criarGestor();
    await conectarWhatsappFake(g.id);

    const r = await api('POST', '/api/disparos', {
      token: g.token,
      body: {
        titulo: 'Ofertas', mensagem: 'oi', grupos: [GRUPO],
        quando: 'agendado', agendado_para: 'nao-e-data',
      },
    });
    expect(r.status).toBe(400);
  });
});

describe('Agendamento', () => {
  beforeEach(limparBanco);

  it('grava o agendamento sem enviar nada na hora', async () => {
    const g = await criarGestor();
    await conectarWhatsappFake(g.id);
    const daquiUmaHora = new Date(Date.now() + 3600_000).toISOString();

    const r = await api('POST', '/api/disparos', {
      token: g.token,
      body: {
        titulo: 'Ofertas', mensagem: 'oi', midias: [MIDIA], grupos: [GRUPO],
        quando: 'agendado', agendado_para: daquiUmaHora, repetir: 'semanal',
      },
    });

    expect(r.status).toBe(201);
    expect(r.body.status).toBe('agendado');

    const lista = await api('GET', '/api/disparos', { token: g.token });
    expect(lista.body).toHaveLength(1);
    expect(lista.body[0].status).toBe('agendado');
    expect(lista.body[0].repetir).toBe('semanal');
    expect(lista.body[0].total_grupos).toBe(1);
    expect(lista.body[0].total_midias).toBe(1);
  });

  it('cancelar um agendamento tira ele da fila de envio', async () => {
    const g = await criarGestor();
    await conectarWhatsappFake(g.id);

    const criado = await api('POST', '/api/disparos', {
      token: g.token,
      body: {
        titulo: 'Ofertas', mensagem: 'oi', grupos: [GRUPO], quando: 'agendado',
        agendado_para: new Date(Date.now() + 3600_000).toISOString(),
      },
    });

    const del = await api('DELETE', `/api/disparos/${criado.body.id}`, { token: g.token });
    expect(del.status).toBe(204);

    const lista = await api('GET', '/api/disparos', { token: g.token });
    expect(lista.body[0].status).toBe('cancelado');
    expect(lista.body[0].proximo_envio).toBeNull();
  });
});

describe('Isolamento entre gestores no disparo', () => {
  beforeEach(limparBanco);

  it('um gestor não vê os disparos do outro', async () => {
    const a = await criarGestor();
    const b = await criarGestor();
    await conectarWhatsappFake(a.id);

    await api('POST', '/api/disparos', {
      token: a.token,
      body: {
        titulo: 'Ofertas', mensagem: 'oi', grupos: [GRUPO], quando: 'agendado',
        agendado_para: new Date(Date.now() + 3600_000).toISOString(),
      },
    });

    expect((await api('GET', '/api/disparos', { token: a.token })).body).toHaveLength(1);
    expect((await api('GET', '/api/disparos', { token: b.token })).body).toHaveLength(0);
  });

  it('um gestor não cancela nem lê os logs do disparo do outro', async () => {
    const a = await criarGestor();
    const b = await criarGestor();
    await conectarWhatsappFake(a.id);

    const criado = await api('POST', '/api/disparos', {
      token: a.token,
      body: {
        titulo: 'Ofertas', mensagem: 'oi', grupos: [GRUPO], quando: 'agendado',
        agendado_para: new Date(Date.now() + 3600_000).toISOString(),
      },
    });

    expect((await api('DELETE', `/api/disparos/${criado.body.id}`, { token: b.token })).status).toBe(403);
    expect((await api('GET', `/api/disparos/${criado.body.id}/logs`, { token: b.token })).status).toBe(403);
  });

  it('não marca como atendida a solicitação de outro gestor', async () => {
    const a = await criarGestor();
    const b = await criarGestor();
    await conectarWhatsappFake(a.id);

    const farmaciaDoB = await criarFarmacia(b.id);
    const solicitacaoDoB = await criarSolicitacao(b.id, farmaciaDoB.id);

    // O gestor A tenta amarrar o disparo dele ao pedido do cliente do B
    await api('POST', '/api/disparos', {
      token: a.token,
      body: {
        titulo: 'Ofertas', mensagem: 'oi', grupos: [GRUPO], quando: 'agendado',
        agendado_para: new Date(Date.now() + 3600_000).toISOString(),
        solicitacao_id: solicitacaoDoB.id,
      },
    });

    // O pedido do B continua pendente — o disparo do A não pode consumi-lo
    const pendentesB = await api('GET', '/api/ofertas/pendentes', { token: b.token });
    expect(pendentesB.body.total).toBe(1);
  });
});

describe('Envio imediato (Evolution simulada)', () => {
  beforeEach(limparBanco);
  afterEach(() => { vi.unstubAllGlobals(); });

  it('envia texto + um criativo por grupo e marca a solicitação como atendida', async () => {
    const g = await criarGestor();
    await conectarWhatsappFake(g.id);
    const f = await criarFarmacia(g.id);
    const s = await criarSolicitacao(g.id, f.id);

    const chamadas = simularEvolution();

    const r = await api('POST', '/api/disparos', {
      token: g.token,
      body: {
        titulo: 'Ofertas', mensagem: 'Promoção da semana',
        midias: [MIDIA], grupos: [GRUPO], quando: 'agora',
        farmacia_id: f.id, solicitacao_id: s.id,
      },
    });

    expect(r.status).toBe(201);
    expect(r.body.enviados).toBe(1);
    expect(r.body.falhas).toBe(0);

    // Uma chamada de texto e uma de mídia, na instância daquele gestor
    expect(chamadas.some((u) => u.includes(`/message/sendText/gestor_${g.id}`))).toBe(true);
    expect(chamadas.some((u) => u.includes(`/message/sendMedia/gestor_${g.id}`))).toBe(true);

    // O pedido do cliente sai da fila
    expect((await api('GET', '/api/ofertas/pendentes', { token: g.token })).body.total).toBe(0);
  });

  it('quando a Evolution recusa, o grupo entra como falha e nada é dado por enviado', async () => {
    const g = await criarGestor();
    await conectarWhatsappFake(g.id);

    simularEvolution(false);

    const r = await api('POST', '/api/disparos', {
      token: g.token,
      body: {
        titulo: 'Ofertas', mensagem: 'oi', midias: [MIDIA],
        grupos: [GRUPO], quando: 'agora',
      },
    });

    expect(r.status).toBe(201);
    expect(r.body.enviados).toBe(0);
    expect(r.body.falhas).toBe(1);

    const logs = await api('GET', `/api/disparos/${r.body.id}/logs`, { token: g.token });
    expect(logs.body[0].status).toBe('erro');
  });
});

/**
 * Rodízio de produtos (migration 0033). Antes disso, campanha repetida mandava
 * a lista inteira em toda ocorrência e em todo horário — o grupo do cliente
 * recebia as mesmas artes dezenas de vezes.
 */
describe('Rodízio de produtos', () => {

  /** Lista de N criativos fake, com rótulo numerado para conferir a ordem. */
  const listaDe = (n: number): MidiaDisparo[] =>
    Array.from({ length: n }, (_, i) => ({ ...MIDIA, rotulo: `p${i}` }));

  const rotulos = (m: MidiaDisparo[]) => m.map((x) => x.rotulo);

  it('anda de 3 em 3 na ordem em que o gestor montou', () => {
    const lista = listaDe(9);

    const a = fatiarRodizio(lista, 0);
    expect(rotulos(a.lote)).toEqual(['p0', 'p1', 'p2']);
    expect(a.proximoCursor).toBe(3);

    const b = fatiarRodizio(lista, a.proximoCursor);
    expect(rotulos(b.lote)).toEqual(['p3', 'p4', 'p5']);

    const c = fatiarRodizio(lista, b.proximoCursor);
    expect(rotulos(c.lote)).toEqual(['p6', 'p7', 'p8']);
    expect(c.proximoCursor).toBe(0);
  });

  it('dá a volta na lista em vez de mandar lote curto', () => {
    // 20 não é múltiplo de 3: o último lote da volta atravessa o fim
    const { lote, proximoCursor } = fatiarRodizio(listaDe(20), 18);

    expect(rotulos(lote)).toEqual(['p18', 'p19', 'p0']);
    expect(proximoCursor).toBe(1);
  });

  it('cobre a lista inteira ao longo das voltas, sem pular ninguém', () => {
    const lista = listaDe(20);
    const vistos = new Set<string>();
    let cursor = 0;

    // 7 postagens já bastam para cobrir 20 produtos em lotes de 3
    for (let i = 0; i < 7; i += 1) {
      const r = fatiarRodizio(lista, cursor);
      r.lote.forEach((m) => vistos.add(m.rotulo!));
      cursor = r.proximoCursor;
    }

    expect(vistos.size).toBe(20);
  });

  it('lista curta vai inteira — não há o que rodiziar', () => {
    const { lote, proximoCursor } = fatiarRodizio(listaDe(2), 0);

    expect(rotulos(lote)).toEqual(['p0', 'p1']);
    expect(proximoCursor).toBe(0);
  });

  it('cursor sujo não quebra o envio', () => {
    // Um disparo editado pode deixar cursor maior que a lista
    expect(rotulos(fatiarRodizio(listaDe(5), 12).lote)).toEqual(['p2', 'p3', 'p4']);
    expect(rotulos(fatiarRodizio(listaDe(5), -1).lote)).toEqual(['p4', 'p0', 'p1']);
    expect(fatiarRodizio([], 3).lote).toEqual([]);
  });

  describe('no envio de verdade', () => {
    beforeEach(limparBanco);
    afterEach(() => { vi.unstubAllGlobals(); });

    /** Quantas imagens saíram de fato para o grupo. */
    const midiasEnviadas = (chamadas: string[]) =>
      chamadas.filter((u) => u.includes('/message/sendMedia')).length;

    it('campanha que se repete manda só 3 produtos por postagem', async () => {
      const g = await criarGestor();
      await conectarWhatsappFake(g.id);

      const chamadas = simularEvolution();

      const r = await api('POST', '/api/disparos', {
        token: g.token,
        body: {
          titulo: 'Ofertas', mensagem: 'Promoção', midias: listaDe(10),
          grupos: [GRUPO], quando: 'agora', repetir: 'semanal',
        },
      });

      expect(r.status).toBe(201);
      expect(midiasEnviadas(chamadas)).toBe(3);
    });

    it('envio único continua mandando tudo — não há segunda chance', async () => {
      const g = await criarGestor();
      await conectarWhatsappFake(g.id);

      const chamadas = simularEvolution();

      const r = await api('POST', '/api/disparos', {
        token: g.token,
        body: {
          titulo: 'Ofertas', mensagem: 'Promoção', midias: listaDe(10),
          grupos: [GRUPO], quando: 'agora', repetir: 'nunca',
        },
      });

      expect(r.status).toBe(201);
      expect(midiasEnviadas(chamadas)).toBe(10);
    });
  });
});
