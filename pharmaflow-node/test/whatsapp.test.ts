/**
 * Conexões WhatsApp globais (Evolution API) e o webhook delas.
 *
 * Escrito como rede de regressão ANTES de whatsapp/service.ts, repository.ts,
 * controller.ts e routes.ts virarem classes (WhatsappRepository/WhatsappService/
 * WhatsappController/ClienteEvolution) — garante que o comportamento HTTP não
 * muda na conversão. A Evolution NUNCA é chamada de verdade: o `fetch` global
 * é substituído, igual ao padrão já usado em disparos.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { api, criarGestor, limparBanco } from './helpers';

/**
 * Evolution falsa: responde o suficiente para connect/qrcode/webhook.
 *
 * `/instance/connectionState` sempre devolve o `estado` simulado — começa em
 * 'connecting', um logout/delete muda sozinho para 'close' (é o que a chamada
 * de verdade faz), e o teste pode forçar outro valor via `setEstado` para
 * simular a Evolution confirmando um evento que chegou por webhook (que não
 * passa pelo fetch nenhum, por isso não atualiza o estado por conta própria).
 */
function simularEvolution() {
  const chamadas: string[] = [];
  let estado: 'connecting' | 'open' | 'close' = 'connecting';

  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url);
    chamadas.push(u);

    if (u.includes('/instance/logout/') || u.includes('/instance/delete/')) {
      estado = 'close';
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (u.includes('/instance/connect/')) {
      return new Response(JSON.stringify({ base64: 'data:image/png;base64,ZmFrZQ==' }), { status: 200 });
    }
    if (u.includes('/instance/connectionState/')) {
      return new Response(JSON.stringify({ instance: { state: estado } }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }));

  return { chamadas, setEstado: (novo: typeof estado) => { estado = novo; } };
}

describe('Conexões (GET)', () => {
  beforeEach(limparBanco);

  it('exige autenticação', async () => {
    expect((await api('GET', '/api/whatsapp/conexoes')).status).toBe(401);
    expect((await api('GET', '/api/whatsapp/status')).status).toBe(401);
  });

  it('sem nenhuma conexão cadastrada, a lista vem vazia', async () => {
    const g = await criarGestor();
    const r = await api('GET', '/api/whatsapp/conexoes', { token: g.token });
    expect(r.status).toBe(200);
    expect(r.body.configurado).toBe(true);
    expect(r.body.conexoes).toEqual([]);
  });

  it('status resumido sem conexão: não conectado, mas configurado', async () => {
    const g = await criarGestor();
    const r = await api('GET', '/api/whatsapp/status', { token: g.token });
    expect(r.status).toBe(200);
    expect(r.body.conectado).toBe(false);
    expect(r.body.configurado).toBe(true);
  });

  it('404 no qrcode quando nenhuma instância foi configurada', async () => {
    const g = await criarGestor();
    const r = await api('GET', '/api/whatsapp/qrcode', { token: g.token });
    expect(r.status).toBe(404);
  });
});

describe('Conectar uma instância', () => {
  beforeEach(limparBanco);
  afterEach(() => { vi.unstubAllGlobals(); });

  it('admin conecta e recebe o QR code', async () => {
    simularEvolution();
    const admin = await criarGestor({ isAdmin: true });

    const r = await api('POST', '/api/whatsapp/connect', {
      token: admin.token, body: { instance_name: 'minha-instancia', nome: 'Principal' },
    });
    expect(r.status).toBe(200);
    expect(r.body.instancia).toBe('minha-instancia');
    expect(r.body.status).toBe('connecting');
    expect(r.body.qr_code).toBeTruthy();

    const lista = await api('GET', '/api/whatsapp/conexoes', { token: admin.token });
    expect(lista.body.conexoes).toHaveLength(1);
    expect(lista.body.conexoes[0].instancia).toBe('minha-instancia');
    expect(lista.body.conexoes[0].nome).toBe('Principal');
  });

  it('gestor comum não conecta, não desconecta nem remove instância', async () => {
    simularEvolution();
    const gestor = await criarGestor();

    expect((await api('POST', '/api/whatsapp/connect', {
      token: gestor.token, body: { instance_name: 'xyz' },
    })).status).toBe(403);
    expect((await api('DELETE', '/api/whatsapp/disconnect', { token: gestor.token })).status).toBe(403);
    expect((await api('DELETE', '/api/whatsapp/instance', { token: gestor.token })).status).toBe(403);
  });

  it('recusa sem instance_name ou com nome em formato inválido', async () => {
    const admin = await criarGestor({ isAdmin: true });

    expect((await api('POST', '/api/whatsapp/connect', {
      token: admin.token, body: {},
    })).status).toBe(400);
    expect((await api('POST', '/api/whatsapp/connect', {
      token: admin.token, body: { instance_name: 'a' },               // curto demais
    })).status).toBe(400);
    expect((await api('POST', '/api/whatsapp/connect', {
      token: admin.token, body: { instance_name: 'tem espaço' },      // caractere inválido
    })).status).toBe(400);
  });

  it('502 quando a Evolution não responde', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const admin = await criarGestor({ isAdmin: true });

    const r = await api('POST', '/api/whatsapp/connect', {
      token: admin.token, body: { instance_name: 'fora-do-ar' },
    });
    expect(r.status).toBe(502);
  });
});

describe('Desconectar e remover instância', () => {
  beforeEach(limparBanco);
  afterEach(() => { vi.unstubAllGlobals(); });

  it('desconecta uma instância existente (logout) sem apagar o cadastro', async () => {
    simularEvolution();
    const admin = await criarGestor({ isAdmin: true });
    await api('POST', '/api/whatsapp/connect', { token: admin.token, body: { instance_name: 'conexao-a' } });

    const r = await api('DELETE', '/api/whatsapp/disconnect?instance=conexao-a', { token: admin.token });
    expect(r.status).toBe(200);

    const lista = await api('GET', '/api/whatsapp/conexoes', { token: admin.token });
    expect(lista.body.conexoes).toHaveLength(1);
    expect(lista.body.conexoes[0].status).toBe('close');
  });

  it('remove a instância por completo', async () => {
    simularEvolution();
    const admin = await criarGestor({ isAdmin: true });
    await api('POST', '/api/whatsapp/connect', { token: admin.token, body: { instance_name: 'conexao-b' } });

    const r = await api('DELETE', '/api/whatsapp/instance?instance=conexao-b', { token: admin.token });
    expect(r.status).toBe(200);

    const lista = await api('GET', '/api/whatsapp/conexoes', { token: admin.token });
    expect(lista.body.conexoes).toHaveLength(0);
  });

  it('404 ao desconectar ou remover uma instância que não existe', async () => {
    const admin = await criarGestor({ isAdmin: true });
    expect((await api('DELETE', '/api/whatsapp/disconnect?instance=fantasma', { token: admin.token })).status).toBe(404);
    expect((await api('DELETE', '/api/whatsapp/instance?instance=fantasma', { token: admin.token })).status).toBe(404);
  });
});

describe('Webhook da Evolution', () => {
  beforeEach(limparBanco);
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.EVOLUTION_WEBHOOK_SECRET;
  });

  it('connection.update marca a instância como conectada', async () => {
    const evolution = simularEvolution();
    const admin = await criarGestor({ isAdmin: true });
    await api('POST', '/api/whatsapp/connect', { token: admin.token, body: { instance_name: 'conexao-c' } });

    // A Evolution de verdade reportaria 'open' se consultada agora — o evento
    // chegou pelo webhook, não pelo fetch, então o simulador não sabe disso sozinho.
    evolution.setEstado('open');

    const r = await api('POST', '/api/whatsapp/webhook', {
      body: { event: 'connection.update', instance: 'conexao-c', data: { state: 'open', phoneNumber: '5511999998888' } },
    });
    expect(r.status).toBe(200);

    const lista = await api('GET', '/api/whatsapp/conexoes', { token: admin.token });
    const conexao = lista.body.conexoes.find((c: { instancia: string }) => c.instancia === 'conexao-c');
    expect(conexao.conectado).toBe(true);
    expect(conexao.numero).toBe('5511999998888');
  });

  it('messages.upsert de número desconhecido não derruba nada', async () => {
    const r = await api('POST', '/api/whatsapp/webhook', {
      body: {
        event: 'messages.upsert',
        data: {
          messages: [{
            key: { remoteJid: '5511000000000@s.whatsapp.net', fromMe: false },
            message: { conversation: 'oi' },
          }],
        },
      },
    });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });

  it('exige o segredo quando EVOLUTION_WEBHOOK_SECRET está configurado', async () => {
    process.env.EVOLUTION_WEBHOOK_SECRET = 'segredo-webhook';

    const semSegredo = await api('POST', '/api/whatsapp/webhook', { body: { event: 'connection.update', data: {} } });
    expect(semSegredo.status).toBe(401);

    const comSegredo = await api('POST', '/api/whatsapp/webhook?secret=segredo-webhook', {
      body: { event: 'connection.update', data: {} },
    });
    expect(comSegredo.status).toBe(200);
  });
});
