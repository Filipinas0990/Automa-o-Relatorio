/**
 * Banco de Imagens: só o admin mexe, e toda ação exige a senha definida no
 * servidor (BANCO_IMAGENS_SENHA_HASH). Cobre também a edição de produto e a
 * troca de imagem da tela de edição.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { app } from '../src/api';
import { api, criarGestor, criarProduto, limparBanco, SENHA_BANCO } from './helpers';

describe('Senha do banco de imagens', () => {
  beforeEach(limparBanco);

  it('admin sem a senha, ou com a senha errada, é barrado com 403 (não 401)', async () => {
    const admin = await criarGestor({ isAdmin: true });
    const p = await criarProduto('Dipirona');

    const sem = await api('PATCH', `/api/catalogo/produtos/${p.id}`, {
      token: admin.token, body: { ativo: false },
    });
    expect(sem.status).toBe(403);
    expect(sem.body.codigo).toBe('senha_banco');

    const errada = await api('DELETE', `/api/catalogo/produtos/${p.id}`, {
      token: admin.token, senhaBanco: 'chute',
    });
    expect(errada.status).toBe(403);

    // Nada mudou
    const lista = await api('GET', '/api/catalogo/produtos', { token: admin.token });
    expect(lista.body.produtos).toHaveLength(1);
    expect(lista.body.produtos[0].ativo).toBe(true);
  });

  it('gestor comum continua barrado mesmo com a senha certa', async () => {
    const gestor = await criarGestor();
    const p = await criarProduto('Vitamina');
    const r = await api('DELETE', `/api/catalogo/produtos/${p.id}`, {
      token: gestor.token, senhaBanco: SENHA_BANCO,
    });
    expect(r.status).toBe(403);
    expect(r.body.codigo).toBeUndefined();
  });

  it('a leitura do catálogo segue livre para o gestor (wizard e disparo usam)', async () => {
    const gestor = await criarGestor();
    const p = await criarProduto('Shampoo');
    expect((await api('GET', '/api/catalogo/produtos', { token: gestor.token })).status).toBe(200);
    expect((await api('GET', `/api/catalogo/produtos/${p.id}/imagem`, { token: gestor.token })).status).toBe(200);
  });

  it('download exige admin e senha', async () => {
    const admin = await criarGestor({ isAdmin: true });
    const gestor = await criarGestor();
    const p = await criarProduto('Sabonete');
    const url = `/api/catalogo/produtos/${p.id}/download`;

    expect((await api('GET', url, { token: gestor.token, senhaBanco: SENHA_BANCO })).status).toBe(403);
    expect((await api('GET', url, { token: admin.token })).status).toBe(403);

    const ok = await api('GET', url, { token: admin.token, senhaBanco: SENHA_BANCO });
    expect(ok.status).toBe(200);
    expect(ok.raw.headers['content-disposition']).toBe('attachment');
  });
});

describe('Edição de produto', () => {
  beforeEach(limparBanco);

  it('renomeia, troca a categoria e desliga numa chamada só', async () => {
    const admin = await criarGestor({ isAdmin: true });
    const p = await criarProduto('Rexona V8', 'Higiene');

    const r = await api('PATCH', `/api/catalogo/produtos/${p.id}`, {
      token: admin.token, senhaBanco: SENHA_BANCO,
      body: { nome: 'Rexona V8 72h 150ml', categoria: 'Desodorante', ativo: false },
    });
    expect(r.status).toBe(200);

    const [prod] = (await api('GET', '/api/catalogo/produtos', { token: admin.token })).body.produtos;
    expect(prod).toMatchObject({ nome: 'Rexona V8 72h 150ml', categoria: 'Desodorante', ativo: false });

    // O nome novo é o que casa na planilha
    await api('PATCH', `/api/catalogo/produtos/${p.id}`, {
      token: admin.token, senhaBanco: SENHA_BANCO, body: { ativo: true },
    });
    const ident = await api('POST', '/api/catalogo/identificar', {
      token: admin.token, body: { produtos: [{ nome: 'Rexona V8 72h 150ml' }] },
    });
    expect(ident.body.produtos[0].catalogoId).toBe(p.id);
  });

  it('409 ao renomear para o nome de outro produto; 400 com nome em branco', async () => {
    const admin = await criarGestor({ isAdmin: true });
    await criarProduto('always noite');
    const p = await criarProduto('always dia');

    const conflito = await api('PATCH', `/api/catalogo/produtos/${p.id}`, {
      token: admin.token, senhaBanco: SENHA_BANCO, body: { nome: 'Always Noite' },
    });
    expect(conflito.status).toBe(409);

    const branco = await api('PATCH', `/api/catalogo/produtos/${p.id}`, {
      token: admin.token, senhaBanco: SENHA_BANCO, body: { nome: '   ' },
    });
    expect(branco.status).toBe(400);
  });

  it('troca a imagem; recusa formato fora de PNG/JPEG/WEBP', async () => {
    const admin = await criarGestor({ isAdmin: true });
    const p = await criarProduto('Pantene');
    const url = `/api/catalogo/produtos/${p.id}/imagem`;

    const ok = await api('PUT', url, {
      token: admin.token, senhaBanco: SENHA_BANCO,
      body: { imagem_b64: `data:image/jpeg;base64,${Buffer.from('nova').toString('base64')}`, mime: 'image/jpeg' },
    });
    expect(ok.status).toBe(200);

    const img = await api('GET', url, { token: admin.token });
    expect(img.raw.headers['content-type']).toBe('image/jpeg');
    expect(img.raw.body).toBe('nova');

    // ETag muda com a troca: o navegador não fica preso na foto antiga
    const etag = img.raw.headers.etag as string;
    const naoMudou = await app.inject({
      method: 'GET', url, headers: { authorization: `Bearer ${admin.token}`, 'if-none-match': etag },
    });
    expect(naoMudou.statusCode).toBe(304);
    await api('PUT', url, {
      token: admin.token, senhaBanco: SENHA_BANCO, body: { imagem_b64: 'b3V0cmE=', mime: 'image/png' },
    });
    const mudou = await app.inject({
      method: 'GET', url, headers: { authorization: `Bearer ${admin.token}`, 'if-none-match': etag },
    });
    expect(mudou.statusCode).toBe(200);
    expect(mudou.body).toBe('outra');

    const gif = await api('PUT', url, {
      token: admin.token, senhaBanco: SENHA_BANCO, body: { imagem_b64: 'YQ==', mime: 'image/gif' },
    });
    expect(gif.status).toBe(400);

    const inexistente = await api('PUT', '/api/catalogo/produtos/99999/imagem', {
      token: admin.token, senhaBanco: SENHA_BANCO, body: { imagem_b64: 'YQ==', mime: 'image/png' },
    });
    expect(inexistente.status).toBe(404);
  });
});

// Por último: o limitador é em memória e por gestor, e o TRUNCATE reinicia os
// ids — um admin travado aqui seria o "mesmo" admin do teste seguinte.
describe('Limite de tentativas', () => {
  beforeEach(limparBanco);

  it('5 senhas erradas travam as ações daquele admin, mesmo com a senha certa depois', async () => {
    const admin = await criarGestor({ isAdmin: true });
    const p = await criarProduto('Neutrogena');
    const url = `/api/catalogo/produtos/${p.id}`;

    for (let i = 0; i < 5; i++) {
      expect((await api('DELETE', url, { token: admin.token, senhaBanco: 'errada' })).status).toBe(403);
    }
    const travado = await api('DELETE', url, { token: admin.token, senhaBanco: SENHA_BANCO });
    expect(travado.status).toBe(429);
    expect(travado.raw.headers['retry-after']).toBeDefined();
  });
});
