/**
 * Produtos que o cliente manda pelo link de ofertas (migration 0041).
 *
 * Regra do dono: cada farmácia tem um espaço de NO MÁXIMO 30 produtos. E,
 * como todo o resto do link, um cliente não alcança o espaço de outro.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { api, criarGestor, criarFarmacia, limparBanco } from './helpers';

/** Menor JPEG que passa na conferência de assinatura do service. */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]).toString('base64');

/** Token do link exclusivo da farmácia, tirado da carteira do gestor. */
async function linkDoCliente(tokenGestor: string, farmaciaId: number): Promise<string> {
  const carteira = await api('GET', '/api/ofertas/carteira', { token: tokenGestor });
  const linha = (carteira.body as Array<{ farmacia_id: number; link: string }>).find((c) => c.farmacia_id === farmaciaId);
  return (linha?.link ?? '').split('/').pop() as string;
}

function enviar(token: string, nome: string, imagem = `data:image/jpeg;base64,${JPEG}`) {
  return api('POST', `/api/publico/ofertas/${token}/meus-produtos`, { body: { nome, imagem } });
}

describe('Produtos do cliente pelo link', () => {
  beforeEach(limparBanco);

  it('guarda o produto e ele aparece no link e para o gestor', async () => {
    const g = await criarGestor();
    const f = await criarFarmacia(g.id);
    const token = await linkDoCliente(g.token, f.id);

    const r = await enviar(token, 'Protetor Solar FPS 50');
    expect(r.status).toBe(201);

    const link = await api('GET', `/api/publico/ofertas/${token}`);
    expect(link.body.meus_produtos.limite).toBe(30);
    expect(link.body.meus_produtos.itens).toEqual([{ id: r.body.id, nome: 'Protetor Solar FPS 50' }]);

    const img = await api('GET', `/api/publico/ofertas/${token}/meus-produtos/${r.body.id}/imagem`);
    expect(img.status).toBe(200);
    expect(img.raw.headers['content-type']).toBe('image/jpeg');

    const doGestor = await api('GET', `/api/ofertas/clientes/${f.id}/produtos`, { token: g.token });
    expect(doGestor.body.itens).toHaveLength(1);
  });

  it('recusa o 31º produto e libera a vaga quando um é excluído', async () => {
    const g = await criarGestor();
    const f = await criarFarmacia(g.id);
    const token = await linkDoCliente(g.token, f.id);

    const ids: number[] = [];
    for (let i = 1; i <= 30; i++) ids.push((await enviar(token, `Produto ${i}`)).body.id);

    const excedente = await enviar(token, 'Produto 31');
    expect(excedente.status).toBe(409);

    expect((await api('DELETE', `/api/publico/ofertas/${token}/meus-produtos/${ids[0]}`)).status).toBe(200);
    expect((await enviar(token, 'Produto 31')).status).toBe(201);
  });

  it('o limite vale mesmo com envios simultâneos', async () => {
    const g = await criarGestor();
    const f = await criarFarmacia(g.id);
    const token = await linkDoCliente(g.token, f.id);

    const respostas = await Promise.all(Array.from({ length: 40 }, (_, i) => enviar(token, `Produto ${i}`)));
    expect(respostas.filter((r) => r.status === 201)).toHaveLength(30);

    const link = await api('GET', `/api/publico/ofertas/${token}`);
    expect(link.body.meus_produtos.itens).toHaveLength(30);
  });

  it('um cliente não vê nem exclui o produto de outro', async () => {
    const g = await criarGestor();
    const fa = await criarFarmacia(g.id);
    const fb = await criarFarmacia(g.id);
    const tokenA = await linkDoCliente(g.token, fa.id);
    const tokenB = await linkDoCliente(g.token, fb.id);

    const doA = (await enviar(tokenA, 'Produto do A')).body.id;

    expect((await api('GET', `/api/publico/ofertas/${tokenB}/meus-produtos/${doA}/imagem`)).status).toBe(404);
    expect((await api('DELETE', `/api/publico/ofertas/${tokenB}/meus-produtos/${doA}`)).status).toBe(404);
    expect((await api('GET', `/api/publico/ofertas/${tokenB}`)).body.meus_produtos.itens).toHaveLength(0);
  });

  it('gestor não lista os produtos de farmácia de outro gestor', async () => {
    const a = await criarGestor();
    const b = await criarGestor();
    const fb = await criarFarmacia(b.id);

    expect((await api('GET', `/api/ofertas/clientes/${fb.id}/produtos`, { token: a.token })).status).toBe(403);
  });

  it('a vitrine do gestor mostra quem enviou e só os clientes da carteira dele', async () => {
    const a = await criarGestor();
    const b = await criarGestor();
    const fa = await criarFarmacia(a.id, { nome: 'Farmácia do A' });
    const fb = await criarFarmacia(b.id, { nome: 'Farmácia do B' });
    await enviar(await linkDoCliente(a.token, fa.id), 'Produto do A');
    await enviar(await linkDoCliente(b.token, fb.id), 'Produto do B');

    const r = await api('GET', '/api/ofertas/produtos-clientes', { token: a.token });
    expect(r.status).toBe(200);
    expect(r.body.itens).toHaveLength(1);
    expect(r.body.itens[0]).toMatchObject({ nome: 'Produto do A', farmacia_id: fa.id, farmacia: 'Farmácia do A' });
  });

  it('produto do cliente entra na lista enviada (id negativo) e o cliente cai como "respondeu"', async () => {
    const g = await criarGestor();
    const f = await criarFarmacia(g.id);
    const outra = await criarFarmacia(g.id);
    const token = await linkDoCliente(g.token, f.id);
    const meu = (await enviar(token, 'Protetor Solar FPS 50')).body.id;
    const deOutro = (await enviar(await linkDoCliente(g.token, outra.id), 'Do vizinho')).body.id;

    const envio = await api('POST', `/api/publico/ofertas/${token}`, {
      body: {
        produtos: [{ id: -meu, preco: '39,90' }, { id: -deOutro, preco: '1,00' }],
        enviado_por: 'Seu Zé',
      },
    });
    expect(envio.status).toBe(201);

    const carteira = await api('GET', '/api/ofertas/carteira', { token: g.token });
    const linha = carteira.body.find((c: { farmacia_id: number }) => c.farmacia_id === f.id);
    expect(linha.respondeu).toBe(true);
    // O produto de outra farmácia não entra, mesmo mandando o id dele.
    expect(linha.solicitacao.produtos).toEqual([
      { id: -meu, nome: 'Protetor Solar FPS 50', preco: '39,90', preco_de: null, origem: 'cliente' },
    ]);
  });

  it('recusa arquivo que não é imagem e produto sem nome', async () => {
    const g = await criarGestor();
    const f = await criarFarmacia(g.id);
    const token = await linkDoCliente(g.token, f.id);

    const naoImagem = Buffer.from('<script>alert(1)</script>').toString('base64');
    expect((await enviar(token, 'Produto', naoImagem)).status).toBe(400);
    expect((await enviar(token, ' ')).status).toBe(400);
  });
});
