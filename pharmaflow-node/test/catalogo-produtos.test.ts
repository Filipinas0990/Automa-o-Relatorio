/**
 * Produtos do catálogo de imagens: cadastro, listagem, imagem, match da
 * planilha (identificar), classificação em lote, ativar/desativar e exclusão.
 *
 * Escrito como rede de regressão ANTES de catalogo/repository.ts e routes.ts
 * virarem classes (ProdutoRepository/CategoriaRepository/CatalogoService/
 * CatalogoController) — garante que o comportamento HTTP não muda na
 * conversão. Teste de cadastro de categorias já existe em categorias.test.ts.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { api, criarGestor, criarProduto, limparBanco, SENHA_BANCO } from './helpers';

describe('Cadastro de produtos', () => {
  beforeEach(limparBanco);

  it('admin cadastra um produto com imagem', async () => {
    const admin = await criarGestor({ isAdmin: true });
    const r = await api('POST', '/api/catalogo/produtos', {
      token: admin.token, senhaBanco: SENHA_BANCO,
      body: { nome: 'Dipirona 500mg', imagem_b64: 'YQ==', mime: 'image/png' },
    });
    expect(r.status).toBe(201);

    const lista = await api('GET', '/api/catalogo/produtos', { token: admin.token });
    expect(lista.body.produtos).toHaveLength(1);
    expect(lista.body.produtos[0].nome).toBe('Dipirona 500mg');
    expect(lista.body.produtos[0].ativo).toBe(true);
  });

  it('recusa cadastro sem nome ou sem imagem', async () => {
    const admin = await criarGestor({ isAdmin: true });
    expect((await api('POST', '/api/catalogo/produtos', {
      token: admin.token, senhaBanco: SENHA_BANCO, body: { imagem_b64: 'YQ==' },
    })).status).toBe(400);
    expect((await api('POST', '/api/catalogo/produtos', {
      token: admin.token, senhaBanco: SENHA_BANCO, body: { nome: 'Sem imagem' },
    })).status).toBe(400);
  });

  it('gestor comum não cadastra, não classifica, não ativa/desativa nem exclui produto', async () => {
    const gestor = await criarGestor();
    const p = await criarProduto('Vitamina D');

    expect((await api('POST', '/api/catalogo/produtos', {
      token: gestor.token, body: { nome: 'Outro', imagem_b64: 'YQ==' },
    })).status).toBe(403);
    expect((await api('PATCH', '/api/catalogo/produtos/categoria', {
      token: gestor.token, body: { ids: [p.id], categoria: 'Vitaminas' },
    })).status).toBe(403);
    expect((await api('PATCH', `/api/catalogo/produtos/${p.id}`, {
      token: gestor.token, body: { ativo: false },
    })).status).toBe(403);
    expect((await api('DELETE', `/api/catalogo/produtos/${p.id}`, { token: gestor.token })).status).toBe(403);
  });

  it('cadastrar com categoria nova registra ela no cadastro de categorias', async () => {
    const admin = await criarGestor({ isAdmin: true });
    await api('POST', '/api/catalogo/produtos', {
      token: admin.token, senhaBanco: SENHA_BANCO,
      body: { nome: 'Protetor solar', imagem_b64: 'YQ==', categoria: 'Dermocosméticos' },
    });

    const categorias = await api('GET', '/api/catalogo/categorias', { token: admin.token });
    expect(categorias.body.categorias.map((c: { nome: string }) => c.nome)).toContain('Dermocosméticos');
  });

  it('reenviar a imagem sem o campo categoria preserva a categoria já classificada', async () => {
    const admin = await criarGestor({ isAdmin: true });
    await api('POST', '/api/catalogo/produtos', {
      token: admin.token, senhaBanco: SENHA_BANCO,
      body: { nome: 'Creme dental', imagem_b64: 'YQ==', categoria: 'Bucal' },
    });
    // Reenvia a mesma imagem sem "categoria" no corpo — não deve apagar a classificação.
    await api('POST', '/api/catalogo/produtos', {
      token: admin.token, senhaBanco: SENHA_BANCO,
      body: { nome: 'Creme dental', imagem_b64: 'YmI=' },
    });

    const lista = await api('GET', '/api/catalogo/produtos', { token: admin.token });
    expect(lista.body.produtos[0].categoria).toBe('Bucal');
  });
});

describe('Imagem do produto', () => {
  beforeEach(limparBanco);

  it('devolve os bytes da imagem com o content-type certo', async () => {
    const admin = await criarGestor({ isAdmin: true });
    const p = await criarProduto('Sabonete');

    const r = await api('GET', `/api/catalogo/produtos/${p.id}/imagem`, { token: admin.token });
    expect(r.status).toBe(200);
    expect(r.raw.headers['content-type']).toBe('image/png');
  });

  it('404 quando o produto não existe ou não tem imagem', async () => {
    const admin = await criarGestor({ isAdmin: true });
    const r = await api('GET', '/api/catalogo/produtos/99999/imagem', { token: admin.token });
    expect(r.status).toBe(404);
  });
});

describe('Status do catálogo', () => {
  beforeEach(limparBanco);

  it('conta quantos produtos existem', async () => {
    const admin = await criarGestor({ isAdmin: true });
    await criarProduto('A');
    await criarProduto('B');

    const r = await api('GET', '/api/catalogo/status', { token: admin.token });
    expect(r.body.total).toBe(2);
  });
});

describe('Ativar/desativar e excluir', () => {
  beforeEach(limparBanco);

  it('desliga um produto e ele continua listado, só com ativo:false', async () => {
    const admin = await criarGestor({ isAdmin: true });
    const p = await criarProduto('Protetor');

    const r = await api('PATCH', `/api/catalogo/produtos/${p.id}`, {
      token: admin.token, senhaBanco: SENHA_BANCO, body: { ativo: false },
    });
    expect(r.status).toBe(200);

    const lista = await api('GET', '/api/catalogo/produtos', { token: admin.token });
    expect(lista.body.produtos[0].ativo).toBe(false);
  });

  it('404 ao desativar produto inexistente; 400 sem o campo "ativo"', async () => {
    const admin = await criarGestor({ isAdmin: true });
    const p = await criarProduto('X');
    expect((await api('PATCH', '/api/catalogo/produtos/99999', {
      token: admin.token, senhaBanco: SENHA_BANCO, body: { ativo: true },
    })).status).toBe(404);
    expect((await api('PATCH', `/api/catalogo/produtos/${p.id}`, {
      token: admin.token, senhaBanco: SENHA_BANCO, body: {},
    })).status).toBe(400);
  });

  it('exclui o produto do catálogo', async () => {
    const admin = await criarGestor({ isAdmin: true });
    const p = await criarProduto('Descartável');

    const r = await api('DELETE', `/api/catalogo/produtos/${p.id}`, { token: admin.token, senhaBanco: SENHA_BANCO });
    expect(r.status).toBe(200);

    const lista = await api('GET', '/api/catalogo/produtos', { token: admin.token });
    expect(lista.body.produtos).toHaveLength(0);
  });
});

describe('Classificação em lote', () => {
  beforeEach(limparBanco);

  it('classifica vários produtos de uma vez', async () => {
    const admin = await criarGestor({ isAdmin: true });
    const a = await criarProduto('Produto A');
    const b = await criarProduto('Produto B');

    const r = await api('PATCH', '/api/catalogo/produtos/categoria', {
      token: admin.token, senhaBanco: SENHA_BANCO, body: { ids: [a.id, b.id], categoria: 'Higiene' },
    });
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(2);

    const lista = await api('GET', '/api/catalogo/produtos', { token: admin.token });
    expect(lista.body.produtos.every((p: { categoria: string | null }) => p.categoria === 'Higiene')).toBe(true);
  });

  it('categoria: null limpa a classificação', async () => {
    const admin = await criarGestor({ isAdmin: true });
    const p = await criarProduto('Produto', 'Higiene');

    const r = await api('PATCH', '/api/catalogo/produtos/categoria', {
      token: admin.token, senhaBanco: SENHA_BANCO, body: { ids: [p.id], categoria: null },
    });
    expect(r.status).toBe(200);

    const lista = await api('GET', '/api/catalogo/produtos', { token: admin.token });
    expect(lista.body.produtos[0].categoria).toBeNull();
  });

  it('400 sem ids, com ids inválidos, ou sem o campo categoria', async () => {
    const admin = await criarGestor({ isAdmin: true });
    const p = await criarProduto('Produto');

    expect((await api('PATCH', '/api/catalogo/produtos/categoria', {
      token: admin.token, senhaBanco: SENHA_BANCO, body: { ids: [], categoria: 'X' },
    })).status).toBe(400);
    expect((await api('PATCH', '/api/catalogo/produtos/categoria', {
      token: admin.token, senhaBanco: SENHA_BANCO, body: { ids: ['abc'], categoria: 'X' },
    })).status).toBe(400);
    expect((await api('PATCH', '/api/catalogo/produtos/categoria', {
      token: admin.token, senhaBanco: SENHA_BANCO, body: { ids: [p.id] },
    })).status).toBe(400);
  });
});

describe('Identificar produtos da planilha', () => {
  beforeEach(limparBanco);

  it('casa por nome exato, por conteúdo, por id do catálogo, e marca o resto como não encontrado', async () => {
    const admin = await criarGestor({ isAdmin: true });
    const dipirona  = await criarProduto('Dipirona 500mg');
    const vitaminaC = await criarProduto('Vitamina C');

    const r = await api('POST', '/api/catalogo/identificar', {
      token: admin.token,
      body: {
        produtos: [
          { nome: 'Dipirona 500mg', preco: '9,90' },                                   // exato
          { nome: 'dipirona',       preco: '9,90' },                                   // por conteúdo
          { nome: 'Qualquer coisa', preco: '1,00', catalogoId: vitaminaC.id },          // por id, sem adivinhação
          { nome: 'Produto inexistente' },                                              // não encontrado
        ],
      },
    });

    expect(r.status).toBe(200);
    const [exato, conteudo, porId, naoAchado] = r.body.produtos;
    expect(exato.status).toBe('encontrado');
    expect(exato.catalogoId).toBe(dipirona.id);
    expect(conteudo.status).toBe('encontrado');
    expect(conteudo.catalogoId).toBe(dipirona.id);
    expect(porId.status).toBe('encontrado');
    expect(porId.catalogoId).toBe(vitaminaC.id);
    expect(naoAchado.status).toBe('nao_encontrado');
    expect(naoAchado.imagem).toBeNull();
  });

  it('produto desligado não entra no match', async () => {
    const admin = await criarGestor({ isAdmin: true });
    const p = await criarProduto('Item desligado');
    await api('PATCH', `/api/catalogo/produtos/${p.id}`, { token: admin.token, senhaBanco: SENHA_BANCO, body: { ativo: false } });

    const r = await api('POST', '/api/catalogo/identificar', {
      token: admin.token,
      body: { produtos: [{ nome: 'Item desligado' }] },
    });
    expect(r.body.produtos[0].status).toBe('nao_encontrado');
  });

  it('400 quando a lista de produtos vem vazia', async () => {
    const admin = await criarGestor({ isAdmin: true });
    const r = await api('POST', '/api/catalogo/identificar', { token: admin.token, body: { produtos: [] } });
    expect(r.status).toBe(400);
  });
});
