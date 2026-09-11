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
import {
  fatiarRodizio, PRODUTOS_POR_ENVIO, calcularProximoEnvio, ehFimDeSemana,
} from '../src/disparos/service';
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
describe('Nada sai no fim de semana', () => {
  /** Data em Brasília, escrita como o gestor pensa. */
  const BRT = (s: string) => new Date(`${s}-03:00`);

  /** Como o dia cai no fuso do disparo — é o que o gestor vê. */
  const diaBR = (d: Date | null) =>
    d ? new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo', weekday: 'short', hour: '2-digit', minute: '2-digit',
    }).format(d) : 'null';

  const disparo = (over: Record<string, unknown> = {}) => ({
    id: 1, repetir: 'diario', timezone: 'America/Sao_Paulo',
    horariosJson: null, repetirAte: null, proximoEnvio: null, ...over,
  } as never);

  // 11/09/2026 = sexta · 12 = sábado · 13 = domingo · 14 = segunda
  const SEXTA_08 = BRT('2026-09-11T08:00:00');
  const SEXTA_18 = BRT('2026-09-11T18:00:00');
  const QUINTA_08 = BRT('2026-09-10T08:00:00');

  it('diário na sexta pula o fim de semana e cai na segunda', () => {
    const p = calcularProximoEnvio(disparo({ proximoEnvio: SEXTA_08 }), SEXTA_08);
    expect(diaBR(p)).toContain('seg.');
  });

  it('dia útil no meio da semana não é adiado', () => {
    const p = calcularProximoEnvio(disparo({ proximoEnvio: QUINTA_08 }), QUINTA_08);
    expect(diaBR(p)).toContain('sex.');
  });

  it('com vários horários, o último da sexta vai para o primeiro da segunda', () => {
    const d = disparo({ proximoEnvio: SEXTA_18, horariosJson: JSON.stringify(['08:00', '18:00']) });
    const p = calcularProximoEnvio(d, SEXTA_18);
    expect(diaBR(p)).toContain('seg.');
    expect(diaBR(p)).toContain('08:00');
  });

  /*
   * A ARMADILHA: a VPS roda em UTC e o horário é de Brasília. Sexta 21:00 BRT
   * é sábado 00:00 em UTC — com getDay() o disparo seria adiado sem motivo.
   */
  it('sexta 21:00 de Brasília NÃO conta como fim de semana (a VPS roda em UTC)', () => {
    expect(ehFimDeSemana(BRT('2026-09-11T21:00:00'))).toBe(false);
    expect(ehFimDeSemana(BRT('2026-09-12T10:00:00'))).toBe(true);   // sábado
    expect(ehFimDeSemana(BRT('2026-09-13T10:00:00'))).toBe(true);   // domingo
    expect(ehFimDeSemana(BRT('2026-09-14T10:00:00'))).toBe(false);  // segunda
  });

  it('envio único marcado no sábado encerra em vez de ser empurrado', () => {
    // Foi o gestor que escolheu aquele dia: adiar postaria num dia que ele não pediu
    const d = disparo({
      repetir: 'nunca',
      proximoEnvio: BRT('2026-09-12T08:00:00'),
      horariosJson: JSON.stringify(['08:00', '18:00']),
    });
    expect(calcularProximoEnvio(d, BRT('2026-09-12T08:00:00'))).toBeNull();
  });

  it('a data de término continua mandando — não vira segunda para poder sair', () => {
    const d = disparo({ proximoEnvio: SEXTA_08, repetirAte: BRT('2026-09-11T23:59:59') });
    expect(calcularProximoEnvio(d, SEXTA_08)).toBeNull();
  });

  it('recuperação de servidor parado não dispara no domingo', () => {
    const domingo = BRT('2026-09-13T10:00:00');
    const p = calcularProximoEnvio(disparo({ proximoEnvio: QUINTA_08 }), domingo);
    expect(diaBR(p)).toContain('seg.');
  });
});

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
    expect(a.acabou).toBe(false);

    const b = fatiarRodizio(lista, a.proximoCursor);
    expect(rotulos(b.lote)).toEqual(['p3', 'p4', 'p5']);

    const c = fatiarRodizio(lista, b.proximoCursor);
    expect(rotulos(c.lote)).toEqual(['p6', 'p7', 'p8']);
    expect(c.acabou).toBe(true);
  });

  it('acabou a lista, acabou a campanha — NÃO recomeça do início', () => {
    // 20 não é múltiplo de 3: a última postagem sai curta, com 2
    const fim = fatiarRodizio(listaDe(20), 18);

    expect(rotulos(fim.lote)).toEqual(['p18', 'p19']);
    expect(fim.proximoCursor).toBe(20);
    expect(fim.acabou).toBe(true);

    // Chamar de novo depois do fim não traz produto nenhum de volta
    const depois = fatiarRodizio(listaDe(20), 20);
    expect(depois.lote).toEqual([]);
    expect(depois.acabou).toBe(true);
  });

  it('cobre a lista inteira, cada produto exatamente uma vez', () => {
    const lista = listaDe(20);
    const vistos: string[] = [];
    let cursor = 0;
    let postagens = 0;

    for (;;) {
      const r = fatiarRodizio(lista, cursor);
      r.lote.forEach((m) => vistos.push(m.rotulo!));
      cursor = r.proximoCursor;
      postagens += 1;
      if (r.acabou) break;
    }

    expect(postagens).toBe(7);              // ceil(20 / 3)
    expect(vistos).toEqual(rotulos(lista)); // ordem preservada, sem repetir
  });

  it('lista curta sai numa postagem só e encerra', () => {
    const { lote, proximoCursor, acabou } = fatiarRodizio(listaDe(2), 0);

    expect(rotulos(lote)).toEqual(['p0', 'p1']);
    expect(proximoCursor).toBe(2);
    expect(acabou).toBe(true);
  });

  // ── Toggle "Repetir os produtos" (migration 0035) ─────────────────────────
  // Ligado, a lista dá a volta e a campanha NUNCA acaba por falta de produto:
  // quem encerra é só a data de término, aplicada por calcularProximoEnvio.

  it('com a volta ligada, o fim da lista volta para o começo', () => {
    const lista = listaDe(20);

    // Última postagem da volta: sai curta (2), e o cursor zera em vez de travar
    const fim = fatiarRodizio(lista, 18, PRODUTOS_POR_ENVIO, true);
    expect(rotulos(fim.lote)).toEqual(['p18', 'p19']);
    expect(fim.proximoCursor).toBe(0);
    expect(fim.acabou).toBe(false);

    // E a volta seguinte recomeça do primeiro produto
    const nova = fatiarRodizio(lista, fim.proximoCursor, PRODUTOS_POR_ENVIO, true);
    expect(rotulos(nova.lote)).toEqual(['p0', 'p1', 'p2']);
    expect(nova.acabou).toBe(false);
  });

  it('com a volta ligada, cursor parado no fim recomeça a lista', () => {
    // Disparo criado antes do toggle, ou editado: cursor pode estar no fim
    const r = fatiarRodizio(listaDe(5), 5, PRODUTOS_POR_ENVIO, true);
    expect(rotulos(r.lote)).toEqual(['p0', 'p1', 'p2']);
    expect(r.acabou).toBe(false);
  });

  it('com a volta ligada, duas voltas cobrem a lista duas vezes na mesma ordem', () => {
    const lista = listaDe(7);
    const vistos: string[] = [];
    let cursor = 0;

    // ceil(7/3) = 3 postagens por volta; 6 postagens = 2 voltas exatas
    for (let i = 0; i < 6; i++) {
      const r = fatiarRodizio(lista, cursor, PRODUTOS_POR_ENVIO, true);
      r.lote.forEach((m) => vistos.push(m.rotulo!));
      cursor = r.proximoCursor;
      expect(r.acabou).toBe(false);   // nunca encerra por falta de produto
    }

    expect(vistos).toEqual([...rotulos(lista), ...rotulos(lista)]);
    expect(cursor).toBe(0);           // fechou a segunda volta redondo
  });

  it('lista VAZIA acaba mesmo com a volta ligada', () => {
    // Sem esta guarda a campanha ficaria eternamente postando nada
    const r = fatiarRodizio([], 0, PRODUTOS_POR_ENVIO, true);
    expect(r.lote).toEqual([]);
    expect(r.acabou).toBe(true);
  });

  it('cursor sujo não quebra o envio', () => {
    // Um disparo editado pode deixar cursor maior que a lista
    expect(fatiarRodizio(listaDe(5), 12).lote).toEqual([]);
    expect(fatiarRodizio(listaDe(5), 12).acabou).toBe(true);
    expect(rotulos(fatiarRodizio(listaDe(5), -1).lote)).toEqual(['p0', 'p1', 'p2']);
    expect(fatiarRodizio([], 3).lote).toEqual([]);
  });

  describe('no envio de verdade', () => {
    beforeEach(limparBanco);
    afterEach(() => { vi.unstubAllGlobals(); });

    /** Quantas imagens saíram de fato para o grupo. */
    const midiasEnviadas = (chamadas: string[]) =>
      chamadas.filter((u) => u.includes('/message/sendMedia')).length;

    /** O disparo como a listagem da tela o mostra. */
    const buscarDisparo = async (token: string, id: number) => {
      const lista = await api('GET', '/api/disparos', { token });
      return lista.body.find((d: { id: number }) => d.id === id);
    };

    it('campanha que se repete manda só 3 produtos por postagem', async () => {
      const g = await criarGestor();
      await conectarWhatsappFake(g.id);

      const chamadas = simularEvolution();

      const r = await api('POST', '/api/disparos', {
        token: g.token,
        body: {
          titulo: 'Ofertas', mensagem: 'Promoção', midias: listaDe(10),
          grupos: [GRUPO], quando: 'agora', repetir: 'diario',
        },
      });

      expect(r.status).toBe(201);
      expect(midiasEnviadas(chamadas)).toBe(3);

      // Sobraram 7 produtos: a campanha segue agendada para o próximo horário
      const d = await buscarDisparo(g.token, r.body.id);
      expect(d.status).toBe('agendado');
      expect(d.proximo_envio).not.toBeNull();
    });

    it('quando a lista acaba, a campanha encerra — não espera a data de término', async () => {
      const g = await criarGestor();
      await conectarWhatsappFake(g.id);

      simularEvolution();

      // 3 produtos e lote de 3: a lista inteira sai na primeira postagem
      const r = await api('POST', '/api/disparos', {
        token: g.token,
        body: {
          titulo: 'Ofertas', mensagem: 'Promoção', midias: listaDe(3),
          grupos: [GRUPO], quando: 'agora', repetir: 'diario',
          // Término daqui a um mês: mesmo assim tem que encerrar agora
          repetir_ate: new Date(Date.now() + 30 * 864e5).toISOString(),
        },
      });

      expect(r.status).toBe(201);

      const d = await buscarDisparo(g.token, r.body.id);
      expect(d.status).toBe('enviado');
      expect(d.proximo_envio).toBeNull();
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
