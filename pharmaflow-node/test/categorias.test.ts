/**
 * Cadastro de categorias do banco de imagens (migration 0031).
 *
 * O que estes testes protegem é a consequência de o produto guardar o TEXTO da
 * categoria, e não um id: renomear e excluir no cadastro precisam mexer no
 * acervo. Se essa cascata quebrar, o produto fica apontando para uma categoria
 * que não existe mais — some dos filtros sem ninguém perceber, porque a tela
 * de imagens continua mostrando tudo.
 *
 * Não há teste de vazamento entre gestores aqui de propósito: o banco de
 * imagens é do grupo inteiro, como todo o resto de /api/catalogo. O que se
 * protege é a escrita ser só do admin.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { api, criarGestor, criarProduto, limparBanco } from './helpers';

/** Só os nomes, para comparar listas sem depender de id nem de data. */
function nomes(body: { categorias: { nome: string }[] }): string[] {
  return body.categorias.map((c) => c.nome);
}

describe('Cadastro de categorias', () => {
  beforeEach(limparBanco);

  it('cria uma categoria vazia — sem produto nenhum nela', async () => {
    const admin = await criarGestor({ isAdmin: true });

    const criada = await api('POST', '/api/catalogo/categorias', {
      token: admin.token, body: { nome: 'Verão 2026' },
    });
    expect(criada.status).toBe(201);
    expect(criada.body.categoria.total).toBe(0);

    const lista = await api('GET', '/api/catalogo/categorias', { token: admin.token });
    expect(nomes(lista.body)).toContain('Verão 2026');
  });

  it('recusa categoria repetida, mesmo com outra grafia', async () => {
    const admin = await criarGestor({ isAdmin: true });
    await api('POST', '/api/catalogo/categorias', {
      token: admin.token, body: { nome: 'Higiene e Beleza' },
    });

    const repetida = await api('POST', '/api/catalogo/categorias', {
      token: admin.token, body: { nome: '  HIGIENE  E  BELEZA ' },
    });

    expect(repetida.status).toBe(409);
    expect(nomes((await api('GET', '/api/catalogo/categorias', { token: admin.token })).body)
      .filter((n) => n.toLowerCase().includes('higiene'))).toHaveLength(1);
  });

  it('conta quantos produtos estão em cada categoria', async () => {
    const admin = await criarGestor({ isAdmin: true });
    await criarProduto('Sabonete', 'Higiene');
    await criarProduto('Shampoo',  'Higiene');
    await criarProduto('Vitamina C', 'Vitaminas');
    await criarProduto('Sem classificação', null);

    const lista = await api('GET', '/api/catalogo/categorias', { token: admin.token });
    const porNome = new Map(lista.body.categorias.map((c: { nome: string; total: number }) => [c.nome, c.total]));

    expect(porNome.get('Higiene')).toBe(2);
    expect(porNome.get('Vitaminas')).toBe(1);
  });

  it('lista categoria que só existe no acervo, para poder ser editada', async () => {
    // Cenário do banco antigo: produto classificado antes de existir cadastro.
    const admin = await criarGestor({ isAdmin: true });
    await criarProduto('Fralda', 'Mamãe e Bebê');

    const lista = await api('GET', '/api/catalogo/categorias', { token: admin.token });
    const cat = lista.body.categorias.find((c: { nome: string }) => c.nome === 'Mamãe e Bebê');

    expect(cat).toBeTruthy();
    expect(cat.id).toBeGreaterThan(0);   // tem id, logo dá para renomear/excluir
    expect(cat.total).toBe(1);
  });

  it('renomear arrasta os produtos junto', async () => {
    const admin = await criarGestor({ isAdmin: true });
    await criarProduto('Protetor solar', 'Dermocosmeticos');

    const lista = await api('GET', '/api/catalogo/categorias', { token: admin.token });
    const id = lista.body.categorias.find((c: { nome: string }) => c.nome === 'Dermocosmeticos').id;

    const r = await api('PATCH', `/api/catalogo/categorias/${id}`, {
      token: admin.token, body: { nome: 'Dermocosméticos' },
    });
    expect(r.status).toBe(200);
    expect(r.body.produtos).toBe(1);

    const produtos = await api('GET', '/api/catalogo/produtos', { token: admin.token });
    expect(produtos.body.produtos[0].categoria).toBe('Dermocosméticos');
  });

  it('recusa renomear para o nome de outra categoria', async () => {
    const admin = await criarGestor({ isAdmin: true });
    const a = await api('POST', '/api/catalogo/categorias', {
      token: admin.token, body: { nome: 'Verão' },
    });
    await api('POST', '/api/catalogo/categorias', {
      token: admin.token, body: { nome: 'Inverno' },
    });

    const r = await api('PATCH', `/api/catalogo/categorias/${a.body.categoria.id}`, {
      token: admin.token, body: { nome: 'inverno' },
    });
    expect(r.status).toBe(409);
  });

  it('excluir deixa o produto sem categoria — não apaga a imagem', async () => {
    const admin = await criarGestor({ isAdmin: true });
    await criarProduto('Desodorante', 'Sazonais');

    const lista = await api('GET', '/api/catalogo/categorias', { token: admin.token });
    const id = lista.body.categorias.find((c: { nome: string }) => c.nome === 'Sazonais').id;

    const r = await api('DELETE', `/api/catalogo/categorias/${id}`, { token: admin.token });
    expect(r.status).toBe(200);
    expect(r.body.produtos).toBe(1);

    const produtos = await api('GET', '/api/catalogo/produtos', { token: admin.token });
    expect(produtos.body.produtos).toHaveLength(1);              // a imagem continua lá
    expect(produtos.body.produtos[0].categoria).toBeNull();      // só perdeu a classificação

    const depois = await api('GET', '/api/catalogo/categorias', { token: admin.token });
    expect(nomes(depois.body)).not.toContain('Sazonais');
  });

  it('classificar em lote registra a categoria nova no cadastro', async () => {
    // Sem isto o gestor cria categoria digitando no banco de imagens e ela
    // nunca aparece na tela de Categorias — impossível renomear ou excluir.
    const admin = await criarGestor({ isAdmin: true });
    const p = await criarProduto('Creme dental');

    await api('PATCH', '/api/catalogo/produtos/categoria', {
      token: admin.token, body: { ids: [p.id], categoria: 'Bucal' },
    });

    const lista = await api('GET', '/api/catalogo/categorias', { token: admin.token });
    expect(nomes(lista.body)).toContain('Bucal');
  });

  it('gestor comum lê a lista, mas não cria, renomeia nem exclui', async () => {
    const admin  = await criarGestor({ isAdmin: true });
    const gestor = await criarGestor();
    const criada = await api('POST', '/api/catalogo/categorias', {
      token: admin.token, body: { nome: 'Verão 2026' },
    });
    const id = criada.body.categoria.id;

    expect((await api('GET', '/api/catalogo/categorias', { token: gestor.token })).status).toBe(200);
    expect((await api('POST', '/api/catalogo/categorias', {
      token: gestor.token, body: { nome: 'Minha categoria' },
    })).status).toBe(403);
    expect((await api('PATCH', `/api/catalogo/categorias/${id}`, {
      token: gestor.token, body: { nome: 'Outra' },
    })).status).toBe(403);
    expect((await api('DELETE', `/api/catalogo/categorias/${id}`, { token: gestor.token })).status).toBe(403);
  });

  it('exige nome e recusa id inexistente', async () => {
    const admin = await criarGestor({ isAdmin: true });

    expect((await api('POST', '/api/catalogo/categorias', {
      token: admin.token, body: { nome: '   ' },
    })).status).toBe(400);
    expect((await api('PATCH', '/api/catalogo/categorias/99999', {
      token: admin.token, body: { nome: 'Qualquer' },
    })).status).toBe(404);
    expect((await api('DELETE', '/api/catalogo/categorias/99999', { token: admin.token })).status).toBe(404);
  });
});
