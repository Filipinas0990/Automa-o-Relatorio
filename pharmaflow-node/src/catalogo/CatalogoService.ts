import { NaoEncontrado, Conflito, RequisicaoInvalida } from '../compartilhado/erros';
import { normalizarCategoria, limparCategoria } from './categorias';
import { normalizar, type ProdutoRepository } from './ProdutoRepository';
import type { CategoriaRepository } from './CategoriaRepository';

export interface ProdutoEntrada {
  nome: string;
  preco?: string;
  /**
   * Id do catálogo, quando o gestor escolheu o produto na grade em vez de
   * digitar o nome. Com ele não há palpite: casa direto, sem passar pelo
   * casamento por texto (dois produtos de nome parecido não se confundem).
   */
  catalogoId?: number | null;
}

export interface ProdutoIdentificado {
  nome: string;                       // nome oficial do catálogo (se achou) ou o digitado
  preco: string;
  status: 'encontrado' | 'nao_encontrado';
  imagem: string | null;             // data URI pronta para <img src>
  catalogoId: number | null;
}

export interface DadosCadastroProduto {
  nome?: string;
  imagem_b64?: string;
  mime?: string;
  categoria?: string | null;
}

export interface CategoriaCadastrada {
  id: number;
  nome: string;
  /** Produtos classificados nela agora. Zero é normal: categoria recém-criada. */
  total: number;
  criadoEm: Date | null;
}

/**
 * Catálogo de produtos com imagem (fluxo de Criativos e Campanhas) e o
 * cadastro de categorias dele. O produto guarda a categoria como TEXTO, não
 * um id — por isso renomear/excluir uma categoria precisa mexer nos produtos.
 */
export class CatalogoService {
  constructor(
    private readonly produtos: ProdutoRepository,
    private readonly categorias: CategoriaRepository,
  ) {}

  // ── Produtos ──────────────────────────────────────────────────────────────

  contarProdutos(): Promise<number> {
    return this.produtos.contar();
  }

  listarProdutos() {
    return this.produtos.listarProdutos();
  }

  /** A imagem de um produto. Lança NaoEncontrado quando não existe ou está sem imagem. */
  async getImagem(id: number): Promise<{ imagemB64: string; mime: string | null }> {
    const img = await this.produtos.getImagem(id);
    if (!img?.imagemB64) throw new NaoEncontrado('Imagem não encontrada.');
    return { imagemB64: img.imagemB64, mime: img.mime };
  }

  /** Cadastra/atualiza um produto do catálogo com sua imagem PNG. */
  async cadastrarProduto(d: DadosCadastroProduto): Promise<void> {
    const nome   = d.nome?.trim();
    const imagem = d.imagem_b64?.trim();
    if (!nome || !imagem) {
      throw new RequisicaoInvalida('nome e imagem_b64 são obrigatórios.');
    }

    // Categoria é texto livre e opcional — o modal deixa subir sem classificar.
    // `undefined` (campo ausente) preserva a categoria de um produto que já
    // existe; string vazia limpa. Só o tipo errado é recusado.
    let categoriaFinal: string | null | undefined;
    if (d.categoria !== undefined) {
      const limpa = limparCategoria(d.categoria);
      if (limpa === undefined) throw new RequisicaoInvalida('Categoria deve ser texto.');
      categoriaFinal = await this.garantirCategoria(limpa);
    }

    // Remove o prefixo data: se vier junto
    const b64 = imagem.includes(',') ? imagem.split(',')[1] : imagem;
    await this.produtos.upsert(nome, b64, d.mime ?? 'image/png', categoriaFinal);
  }

  /** Classifica um ou vários produtos de uma vez. `categoria: null` limpa a classificação. */
  async classificarEmLote(ids: unknown, categoria: unknown): Promise<number> {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new RequisicaoInvalida('Envie ao menos um id em "ids".');
    }
    const limpos = ids
      .map((v) => (typeof v === 'number' ? v : parseInt(String(v), 10)))
      .filter((n) => Number.isInteger(n) && n > 0);
    if (limpos.length !== ids.length) {
      throw new RequisicaoInvalida('A lista "ids" tem valores que não são id de produto.');
    }
    // Teto para não transformar um bug de front num UPDATE no acervo inteiro.
    if (limpos.length > 500) {
      throw new RequisicaoInvalida('Classifique no máximo 500 produtos por vez.');
    }
    if (categoria === undefined) {
      throw new RequisicaoInvalida('Envie o campo "categoria" (texto, ou null para limpar).');
    }
    const limpa = limparCategoria(categoria);
    if (limpa === undefined) throw new RequisicaoInvalida('Categoria deve ser texto.');

    return this.produtos.setCategoriaEmLote(limpos, await this.garantirCategoria(limpa));
  }

  /** Liga/desliga um produto. Lança NaoEncontrado se o produto não existir. */
  async setAtivo(id: number, ativo: unknown): Promise<void> {
    if (typeof ativo !== 'boolean') {
      throw new RequisicaoInvalida('Campo "ativo" (boolean) é obrigatório.');
    }
    if (!await this.produtos.setAtivo(id, ativo)) {
      throw new NaoEncontrado('Produto não encontrado.');
    }
  }

  deletarProduto(id: number): Promise<void> {
    return this.produtos.deletar(id);
  }

  /**
   * Recebe a lista de produtos da planilha e devolve cada um com a imagem do
   * catálogo (quando o nome bate) ou marcado como não encontrado.
   */
  async identificarProdutos(entradasBrutas: unknown): Promise<ProdutoIdentificado[]> {
    const entradas = Array.isArray(entradasBrutas) ? entradasBrutas as ProdutoEntrada[] : [];
    if (entradas.length === 0) {
      throw new RequisicaoInvalida('Envie ao menos um produto em "produtos".');
    }

    const catalogo = await this.produtos.carregarAtivos();

    return entradas.map((entrada) => {
      const alvo = normalizar(entrada.nome);

      // 0) veio da grade do catálogo: o id manda, sem adivinhação por texto
      // 1) match exato pelo nome normalizado
      // 2) match por conteúdo (um contém o outro) — cobre variações de escrita
      const achado = entrada.catalogoId
        ? catalogo.find((c) => c.id === entrada.catalogoId)
        : catalogo.find((c) => c.nomeNorm === alvo) ??
          catalogo.find((c) => c.nomeNorm.includes(alvo) || alvo.includes(c.nomeNorm));

      if (achado) {
        return {
          nome:       achado.nome,
          preco:      entrada.preco?.trim() || '—',
          status:     'encontrado' as const,
          imagem:     achado.imagemB64
            ? `data:${achado.mime ?? 'image/png'};base64,${achado.imagemB64}`
            : null,
          catalogoId: achado.id,
        };
      }

      return {
        nome:       entrada.nome,
        preco:      entrada.preco?.trim() || '—',
        status:     'nao_encontrado' as const,
        imagem:     null,
        catalogoId: null,
      };
    });
  }

  // ── Categorias ────────────────────────────────────────────────────────────

  /**
   * Antifragmentação do texto livre: se o que o gestor digitou normaliza igual a
   * uma categoria que já existe, grava a GRAFIA JÁ CADASTRADA em vez da digitada.
   * Olha o CADASTRO primeiro e o acervo depois: uma categoria recém-criada ainda
   * não tem produto nenhum, e é justamente ela que precisa atrair a digitação.
   */
  async canonizarCategoria(texto: string | null): Promise<string | null> {
    if (!texto) return null;
    const alvo = normalizarCategoria(texto);
    if (!alvo) return null;

    const cadastrada = await this.categorias.buscarPorNomeNorm(alvo);
    if (cadastrada) return cadastrada.nome;

    const igual = (await this.produtos.categoriasEmUso()).find((c) => normalizarCategoria(c.nome) === alvo);
    return igual ? igual.nome : texto;
  }

  /**
   * Canoniza E garante linha no cadastro. É por aqui que TODA escrita de
   * categoria passa (upload de imagem e classificação em lote).
   */
  async garantirCategoria(texto: string | null): Promise<string | null> {
    const nome = await this.canonizarCategoria(texto);
    if (!nome) return null;
    await this.categorias.criar(nome, normalizarCategoria(nome));
    return nome;
  }

  /** O cadastro com a contagem de produtos de cada categoria, em ordem alfabética. */
  async listarCategorias(): Promise<CategoriaCadastrada[]> {
    const emUso = await this.produtos.categoriasEmUso();
    let cadastro = await this.categorias.listar();

    const sincronizadas = await this.sincronizarCadastro(emUso, cadastro);
    if (sincronizadas > 0) cadastro = await this.categorias.listar();

    // Contagem casada pela chave normalizada, calculada em JS dos dois lados:
    // assim uma divergência entre o normalizador do SQL (migration) e o do
    // TypeScript não faria a categoria aparecer com zero produto.
    const total = new Map(emUso.map((c) => [normalizarCategoria(c.nome), c.total]));

    return cadastro
      .map((c) => ({
        id:       c.id,
        nome:     c.nome,
        total:    total.get(normalizarCategoria(c.nome)) ?? 0,
        criadoEm: c.criadoEm,
      }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }

  /**
   * Registra as categorias que estão aplicadas a produtos mas ficaram sem
   * linha no cadastro. Devolve quantas entraram. Rede de segurança, não
   * caminho normal — toda escrita passa por `garantirCategoria`.
   */
  private async sincronizarCadastro(
    emUso: Array<{ nome: string }>,
    cadastradas: Array<{ nome: string }>,
  ): Promise<number> {
    const conhecidas = new Set(cadastradas.map((c) => normalizarCategoria(c.nome)));
    const faltando = new Map<string, string>();
    for (const c of emUso) {
      const chave = normalizarCategoria(c.nome);
      if (!chave || conhecidas.has(chave) || faltando.has(chave)) continue;
      faltando.set(chave, c.nome);
    }
    if (faltando.size === 0) return 0;

    return this.categorias.criarVarias(
      [...faltando].map(([nomeNorm, nome]) => ({ nome, nomeNorm })),
    );
  }

  /**
   * Cadastra uma categoria vazia, antes de existir imagem nela. Lança
   * RequisicaoInvalida se o nome vier em branco ou do tipo errado, e
   * Conflito se já existir uma categoria que normaliza igual.
   */
  async criarCategoria(nomeBruto: unknown): Promise<CategoriaCadastrada> {
    const nome = this.exigirNomeCategoria(nomeBruto);
    const row = await this.categorias.criar(nome, normalizarCategoria(nome));
    if (!row) throw new Conflito(`A categoria "${nome}" já existe.`);
    return { id: row.id, nome: row.nome, total: 0, criadoEm: row.criadoEm };
  }

  /** Valida o nome vindo do corpo da requisição. Lança RequisicaoInvalida quando inválido. */
  private exigirNomeCategoria(bruto: unknown): string {
    const limpo = limparCategoria(bruto);
    if (limpo === undefined) throw new RequisicaoInvalida('Nome da categoria deve ser texto.');
    if (!limpo) throw new RequisicaoInvalida('Informe o nome da categoria.');
    return limpo;
  }

  /**
   * Todas as grafias de uma categoria que aparecem no acervo. Renomear precisa
   * disto porque o produto guarda texto: basta um registro anterior à
   * canonização para um UPDATE por igualdade exata deixar produto órfão.
   */
  private async grafiasNoAcervo(nome: string): Promise<string[]> {
    const alvo = normalizarCategoria(nome);
    return (await this.produtos.categoriasEmUso())
      .filter((c) => normalizarCategoria(c.nome) === alvo)
      .map((c) => c.nome);
  }

  /** Reescreve a categoria dos produtos. `para: null` deixa sem categoria. */
  private async reclassificar(de: string, para: string | null): Promise<number> {
    const grafias = await this.grafiasNoAcervo(de);
    return this.produtos.reclassificar(grafias, para);
  }

  /**
   * Renomeia a categoria e arrasta os produtos junto. Lança NaoEncontrado se
   * a categoria não existir, e Conflito se já houver outra com esse nome.
   */
  async renomearCategoria(
    id: number, nomeBruto: unknown,
  ): Promise<{ categoria: CategoriaCadastrada; produtos: number }> {
    const nome = this.exigirNomeCategoria(nomeBruto);
    const atual = await this.exigirCategoria(id);

    const norm = normalizarCategoria(nome);
    if (await this.categorias.existeComNomeNorm(norm, id)) {
      throw new Conflito(`Já existe uma categoria "${nome}".`);
    }

    await this.categorias.renomear(id, nome, norm);
    const produtos = await this.reclassificar(atual.nome, nome);

    return { categoria: { id: atual.id, nome, total: produtos, criadoEm: atual.criadoEm }, produtos };
  }

  /**
   * Exclui a categoria do cadastro. Os produtos dela NÃO são apagados — ficam
   * sem categoria. Lança NaoEncontrado se a categoria não existir. Devolve
   * quantos produtos ficaram sem classificação.
   */
  async excluirCategoria(id: number): Promise<{ produtos: number }> {
    const atual = await this.exigirCategoria(id);
    const produtos = await this.reclassificar(atual.nome, null);
    await this.categorias.excluir(id);
    return { produtos };
  }

  private async exigirCategoria(id: number) {
    const categoria = await this.categorias.buscarPorId(id);
    if (!categoria) throw new NaoEncontrado('Categoria não encontrada.');
    return categoria;
  }
}
