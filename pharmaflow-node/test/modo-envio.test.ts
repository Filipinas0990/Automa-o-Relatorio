/**
 * Trava de envio: fora do servidor de produção, NADA sai para o WhatsApp.
 *
 * INCIDENTE 24/11/2026: 36 imagens caíram no grupo da Farmácia Noturna pela
 * conexão da Anielly às 08:52, de uma campanha que tinha terminado em 08/11.
 * O servidor não fez a chamada (banco, API, motor e fila do Redis limpos) —
 * foi uma CÓPIA do PharmaFlow rodando em outro computador, com a .env
 * apontando para a Evolution de produção e a mesma chave.
 *
 * A regra: só envia de verdade quem tem WHATSAPP_ENVIO_REAL=true. Sem isso o
 * sistema funciona inteiro (telas, agendamento, histórico), mas toda chamada
 * que MEXE no WhatsApp é simulada: enviar mensagem, conectar, desconectar,
 * criar ou apagar conexão. Consultas (status, grupos) continuam passando.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { api, criarGestor, conectarWhatsappFake, limparBanco } from './helpers';
import { envioRealLigado, ehConsulta, EnvioPorAmbiente } from '../src/compartilhado/ModoEnvio';
import { ClienteEvolution } from '../src/whatsapp/ClienteEvolution';
import { ClienteCampanhas } from '../src/disparos/ClienteCampanhas';

const GRUPO = { jid: '55119999@g.us', nome: 'Grupo de Ofertas' };
const MIDIA = { b64: 'ZmFrZQ==', mime: 'image/png', rotulo: 'Dipirona — R$ 9,90' };

/** Evolution falsa que anota cada URL chamada. */
function simularEvolution(): string[] {
  const chamadas: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url);
    chamadas.push(u);
    if (u.includes('/instance/connectionState/')) {
      return new Response(JSON.stringify({ instance: { state: 'open' } }), { status: 200 });
    }
    return new Response(JSON.stringify({ key: { id: 'REAL' } }), { status: 200 });
  }));
  return chamadas;
}

const modoTeste  = () => vi.stubEnv('WHATSAPP_ENVIO_REAL', '');
const envioReal  = () => vi.stubEnv('WHATSAPP_ENVIO_REAL', 'true');

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

// ── Regra pura ───────────────────────────────────────────────────────────────

describe('Quando o envio é real (regra)', () => {
  it('só "true" liga o envio — ausente, vazio ou qualquer outra coisa é modo teste', () => {
    expect(envioRealLigado({ WHATSAPP_ENVIO_REAL: 'true' })).toBe(true);
    expect(envioRealLigado({ WHATSAPP_ENVIO_REAL: ' TRUE ' })).toBe(true);
    for (const v of [undefined, '', 'false', '1', 'sim', 'yes', 'verdadeiro']) {
      expect(envioRealLigado({ WHATSAPP_ENVIO_REAL: v }), `valor ${v}`).toBe(false);
    }
  });

  it('consultas passam: status da conexão, lista de conexões, grupos', () => {
    expect(ehConsulta('GET', '/instance/connectionState/gestor_1')).toBe(true);
    expect(ehConsulta('GET', '/instance/fetchInstances?instanceName=anielly')).toBe(true);
    expect(ehConsulta('GET', '/group/fetchAllGroups/anielly?getParticipants=false')).toBe(true);
  });

  it('o que mexe no WhatsApp NÃO é consulta: enviar, conectar, desconectar, criar, apagar', () => {
    expect(ehConsulta('POST', '/message/sendMedia/anielly')).toBe(false);
    expect(ehConsulta('POST', '/message/sendText/anielly')).toBe(false);
    expect(ehConsulta('GET', '/instance/connect/gestor_1')).toBe(false);
    expect(ehConsulta('POST', '/instance/create')).toBe(false);
    expect(ehConsulta('DELETE', '/instance/logout/gestor_1')).toBe(false);
    expect(ehConsulta('DELETE', '/instance/delete/anielly')).toBe(false);
    // Mesmo caminho de consulta com outro método não é consulta
    expect(ehConsulta('POST', '/group/fetchAllGroups/anielly')).toBe(false);
  });

  it('a política lê o ambiente na hora (dá para ligar sem reiniciar o processo de teste)', () => {
    const p = new EnvioPorAmbiente();
    modoTeste();
    expect(p.envioReal()).toBe(false);
    envioReal();
    expect(p.envioReal()).toBe(true);
  });
});

// ── Clientes HTTP ────────────────────────────────────────────────────────────

describe('Cliente da Evolution respeita a trava', () => {
  it('modo teste: envio de mensagem é simulado e NÃO chega na Evolution', async () => {
    modoTeste();
    const chamadas = simularEvolution();

    const r = await new ClienteEvolution().req('POST', '/message/sendMedia/anielly', { number: GRUPO.jid });

    expect(chamadas).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.data).toMatchObject({ modoTeste: true });
  });

  it('modo teste: desconectar também é simulado (não derruba a conexão de produção)', async () => {
    modoTeste();
    const chamadas = simularEvolution();

    await new ClienteEvolution().req('DELETE', '/instance/logout/gestor_1');
    expect(chamadas).toEqual([]);
  });

  it('modo teste: consulta passa normalmente', async () => {
    modoTeste();
    const chamadas = simularEvolution();

    const r = await new ClienteEvolution().req('GET', '/instance/connectionState/gestor_1');
    expect(chamadas).toHaveLength(1);
    expect(r.data).toMatchObject({ instance: { state: 'open' } });
  });

  it('envio real: a mensagem sai', async () => {
    envioReal();
    const chamadas = simularEvolution();

    await new ClienteEvolution().req('POST', '/message/sendMedia/anielly', { number: GRUPO.jid });
    expect(chamadas).toEqual(['http://127.0.0.1:1/message/sendMedia/anielly']);
  });

  it('modo teste: o motor de campanhas fica desligado, mesmo configurado', async () => {
    modoTeste();
    vi.stubEnv('CAMPAIGNS_API_URL', 'http://motor.teste');
    const chamadas = simularEvolution();
    const motor = new ClienteCampanhas();

    expect(motor.configurado()).toBe(false);
    // E se alguém chamar direto, não enfileira — e não finge que enfileirou
    const r = await motor.enfileirar({ disparoId: 1, instance: 'anielly', groups: [GRUPO] });
    expect(r.ok).toBe(false);
    expect(chamadas).toEqual([]);
  });

  it('envio real: o motor configurado é usado', () => {
    envioReal();
    vi.stubEnv('CAMPAIGNS_API_URL', 'http://motor.teste');
    expect(new ClienteCampanhas().configurado()).toBe(true);
  });
});

// ── Ponta a ponta ────────────────────────────────────────────────────────────

describe('Trava de envio ponta a ponta', () => {
  beforeEach(limparBanco);

  it('modo teste: disparo "agora" completa na tela, mas nenhuma mensagem sai', async () => {
    modoTeste();
    const g = await criarGestor();
    await conectarWhatsappFake(g.id);
    const chamadas = simularEvolution();

    const r = await api('POST', '/api/disparos', {
      token: g.token,
      body: {
        titulo: 'Ofertas', mensagem: 'Promoção', midias: [MIDIA, MIDIA],
        grupos: [GRUPO], quando: 'agora', repetir: 'nunca',
      },
    });

    expect(r.status).toBe(201);
    expect(chamadas.filter((u) => u.includes('/message/'))).toEqual([]);
  });

  it('a tela consegue saber se o envio é real (para avisar o gestor)', async () => {
    const g = await criarGestor();

    modoTeste();
    expect((await api('GET', '/api/disparos/modo-envio', { token: g.token })).body).toEqual({ envio_real: false });

    envioReal();
    expect((await api('GET', '/api/disparos/modo-envio', { token: g.token })).body).toEqual({ envio_real: true });

    expect((await api('GET', '/api/disparos/modo-envio')).status).toBe(401);
  });
});
