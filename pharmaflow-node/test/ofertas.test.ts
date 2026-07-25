/**
 * Ofertas: link público do gestor e isolamento entre gestores.
 *
 * Estas são as regras mais caras de quebrar do sistema. A agência tem vários
 * gestores, cada um com 16–20 farmácias clientes — se vazar, um gestor enxerga
 * (ou dispara para) o cliente de outro.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  api, criarGestor, criarFarmacia, criarProduto, criarSolicitacao, limparBanco,
} from './helpers';

describe('Link público de ofertas', () => {
  beforeEach(limparBanco);

  it('cria um link por gestor, e cada gestor recebe um token diferente', async () => {
    const a = await criarGestor();
    const b = await criarGestor();

    const linkA = await api('GET', '/api/ofertas/link', { token: a.token });
    const linkB = await api('GET', '/api/ofertas/link', { token: b.token });

    expect(linkA.status).toBe(200);
    expect(linkB.status).toBe(200);
    expect(linkA.body.token).toBeTruthy();
    expect(linkA.body.token).not.toBe(linkB.body.token);
    expect(linkA.body.url).toContain(linkA.body.token);
  });

  it('devolve o mesmo link em chamadas seguidas (não gera um novo a cada vez)', async () => {
    const g = await criarGestor();
    const um   = await api('GET', '/api/ofertas/link', { token: g.token });
    const dois = await api('GET', '/api/ofertas/link', { token: g.token });
    expect(um.body.token).toBe(dois.body.token);
  });

  it('regenerar invalida o link antigo na hora', async () => {
    const g = await criarGestor();
    await criarFarmacia(g.id);

    const antigo = (await api('GET', '/api/ofertas/link', { token: g.token })).body.token;
    const novo   = (await api('POST', '/api/ofertas/link/regenerar', { token: g.token })).body.token;

    expect(novo).not.toBe(antigo);
    expect((await api('GET', `/api/publico/ofertas/${antigo}`)).status).toBe(404);
    expect((await api('GET', `/api/publico/ofertas/${novo}`)).status).toBe(200);
  });

  it('abre sem autenticação e mostra só as farmácias daquele gestor', async () => {
    const a = await criarGestor();
    const b = await criarGestor();
    await criarFarmacia(a.id, { nome: 'Farmácia do A' });
    await criarFarmacia(b.id, { nome: 'Farmácia do B' });

    const token = (await api('GET', '/api/ofertas/link', { token: a.token })).body.token;

    // Sem header de autenticação — é o dono da farmácia abrindo pelo celular
    const publico = await api('GET', `/api/publico/ofertas/${token}`);

    expect(publico.status).toBe(200);
    const nomes = publico.body.farmacias.map((f: { nome: string }) => f.nome);
    expect(nomes).toContain('Farmácia do A');
    expect(nomes).not.toContain('Farmácia do B');
  });

  it('token inexistente responde 404 genérico', async () => {
    const r = await api('GET', '/api/publico/ofertas/token-que-nao-existe');
    expect(r.status).toBe(404);
  });
});

describe('Envio da lista pelo dono', () => {
  beforeEach(limparBanco);

  it('aceita a seleção e ela chega para o gestor certo', async () => {
    const g = await criarGestor();
    const f = await criarFarmacia(g.id);
    const p = await criarProduto('Dipirona 500mg');
    const token = (await api('GET', '/api/ofertas/link', { token: g.token })).body.token;

    const envio = await api('POST', `/api/publico/ofertas/${token}`, {
      body: {
        farmacia_id: f.id,
        produtos: [p.id],
        produtos_livres: 'Vitamina C 1g',
        enviado_por: 'Seu Zé',
      },
    });
    expect(envio.status).toBe(201);

    const lista = await api('GET', '/api/ofertas/solicitacoes', { token: g.token });
    expect(lista.body).toHaveLength(1);
    expect(lista.body[0].farmacia).toBe(f.nome);
    expect(lista.body[0].produtos[0].nome).toBe('Dipirona 500mg');
    expect(lista.body[0].produtos_livres).toBe('Vitamina C 1g');
    expect(lista.body[0].status).toBe('pendente');
  });

  it('BLOQUEIA enviar para farmácia de outro gestor', async () => {
    const a = await criarGestor();
    const b = await criarGestor();
    await criarFarmacia(a.id);
    const farmaciaDoB = await criarFarmacia(b.id);

    const tokenDoA = (await api('GET', '/api/ofertas/link', { token: a.token })).body.token;

    const r = await api('POST', `/api/publico/ofertas/${tokenDoA}`, {
      body: { farmacia_id: farmaciaDoB.id, produtos: [] , produtos_livres: 'qualquer coisa' },
    });

    expect(r.status).toBe(403);
  });

  it('recusa envio vazio', async () => {
    const g = await criarGestor();
    const f = await criarFarmacia(g.id);
    const token = (await api('GET', '/api/ofertas/link', { token: g.token })).body.token;

    const r = await api('POST', `/api/publico/ofertas/${token}`, {
      body: { farmacia_id: f.id, produtos: [] },
    });
    expect(r.status).toBe(400);
  });
});

describe('Isolamento entre gestores', () => {
  beforeEach(limparBanco);

  it('um gestor não vê as solicitações do outro', async () => {
    const a = await criarGestor();
    const b = await criarGestor();
    const fa = await criarFarmacia(a.id);
    await criarSolicitacao(a.id, fa.id);

    const listaA = await api('GET', '/api/ofertas/solicitacoes', { token: a.token });
    const listaB = await api('GET', '/api/ofertas/solicitacoes', { token: b.token });

    expect(listaA.body).toHaveLength(1);
    expect(listaB.body).toHaveLength(0);
  });

  it('um gestor não altera o status da solicitação do outro', async () => {
    const a = await criarGestor();
    const b = await criarGestor();
    const fa = await criarFarmacia(a.id);
    const s = await criarSolicitacao(a.id, fa.id);

    const r = await api('PATCH', `/api/ofertas/solicitacoes/${s.id}`, {
      token: b.token, body: { status: 'atendida' },
    });
    expect(r.status).toBe(403);
  });

  it('o contador de pendentes é por gestor', async () => {
    const a = await criarGestor();
    const b = await criarGestor();
    const fa = await criarFarmacia(a.id);
    await criarSolicitacao(a.id, fa.id);

    expect((await api('GET', '/api/ofertas/pendentes', { token: a.token })).body.total).toBe(1);
    expect((await api('GET', '/api/ofertas/pendentes', { token: b.token })).body.total).toBe(0);
  });

  it('exige autenticação nas rotas do gestor', async () => {
    expect((await api('GET', '/api/ofertas/solicitacoes')).status).toBe(401);
    expect((await api('GET', '/api/ofertas/carteira')).status).toBe(401);
    expect((await api('GET', '/api/ofertas/link')).status).toBe(401);
  });
});

describe('Carteira (quem respondeu e quem não)', () => {
  beforeEach(limparBanco);

  it('lista TODAS as farmácias, marcando quem tem pedido pendente', async () => {
    const g = await criarGestor();
    const comPedido = await criarFarmacia(g.id, { nome: 'Respondeu' });
    await criarFarmacia(g.id, { nome: 'Não respondeu' });
    await criarSolicitacao(g.id, comPedido.id, [{ id: 1, nome: 'Dipirona' }]);

    const r = await api('GET', '/api/ofertas/carteira', { token: g.token });

    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(2);

    const respondeu    = r.body.find((c: { farmacia: string }) => c.farmacia === 'Respondeu');
    const naoRespondeu = r.body.find((c: { farmacia: string }) => c.farmacia === 'Não respondeu');

    expect(respondeu.respondeu).toBe(true);
    expect(respondeu.solicitacao.produtos).toHaveLength(1);
    expect(naoRespondeu.respondeu).toBe(false);
    expect(naoRespondeu.solicitacao).toBeNull();
  });

  it('depois de atendida, o cliente volta a aparecer como sem resposta', async () => {
    const g = await criarGestor();
    const f = await criarFarmacia(g.id);
    const s = await criarSolicitacao(g.id, f.id);

    expect((await api('GET', '/api/ofertas/carteira', { token: g.token })).body[0].respondeu).toBe(true);

    await api('PATCH', `/api/ofertas/solicitacoes/${s.id}`, {
      token: g.token, body: { status: 'atendida' },
    });

    const depois = await api('GET', '/api/ofertas/carteira', { token: g.token });
    expect(depois.body[0].respondeu).toBe(false);
    // ...mas o histórico de que já enviou um dia continua ali
    expect(depois.body[0].ultimo_envio_em).toBeTruthy();
  });

  it('a carteira de um gestor não inclui farmácia de outro', async () => {
    const a = await criarGestor();
    const b = await criarGestor();
    await criarFarmacia(a.id, { nome: 'Do A' });
    await criarFarmacia(b.id, { nome: 'Do B' });

    const r = await api('GET', '/api/ofertas/carteira', { token: a.token });
    const nomes = r.body.map((c: { farmacia: string }) => c.farmacia);

    expect(nomes).toEqual(['Do A']);
  });
});
