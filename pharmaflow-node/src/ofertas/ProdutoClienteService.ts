import type { Gestor } from '../database/schema';
import { Conflito, NaoEncontrado, Proibido, RequisicaoInvalida } from '../compartilhado/erros';
import { logger } from '../logger';
import type { FarmaciaRepository } from '../farmacias/FarmaciaRepository';

/** O banco recusou o produto: a farmácia já está no limite. Parte do contrato de `EspacoDoCliente.criar`. */
export class EspacoCheio extends Error {}

/**
 * Quantos produtos cada farmácia pode guardar. O banco garante o mesmo número
 * no gatilho da migration 0041 — mudar um sem o outro não adianta.
 */
export const LIMITE_PRODUTOS_CLIENTE = 30;

/**
 * Teto da foto já decodificada. O front comprime antes de mandar (JPEG ~1200px
 * fica bem abaixo disto); o teto existe porque a rota é pública.
 */
const MAX_BYTES_FOTO = 900 * 1024;

export interface ProdutoDoCliente {
  id:       number;
  nome:     string;
  criadoEm: Date | null;
}

export interface FotoDoProduto {
  imagemB64: string;
  mime:      string;
}

/** O espaço de produtos de cada farmácia, como a regra precisa dele. */
export interface EspacoDoCliente {
  listar(farmaciaId: number): Promise<ProdutoDoCliente[]>;
  contar(farmaciaId: number): Promise<number>;
  /** Lança `EspacoCheio` quando o banco recusa por limite. */
  criar(farmaciaId: number, dados: { nome: string; imagemB64: string; mime: string }): Promise<ProdutoDoCliente>;
  foto(farmaciaId: number, id: number): Promise<FotoDoProduto | null>;
  excluir(farmaciaId: number, id: number): Promise<boolean>;
}

/** Produto com o cliente que mandou — a vitrine do gestor junta todos. */
export interface ProdutoComCliente extends ProdutoDoCliente {
  farmaciaId:     number;
  farmacia:       string;
  farmaciaVisivel: string;
  cidade:         string | null;
}

/** Leitura de todos os espaços de uma carteira (null = todas as farmácias, para o admin). */
export interface VitrineDosClientes {
  daCarteira(gestorId: number | null): Promise<ProdutoComCliente[]>;
}

export interface EnvioDeProduto {
  nome?:   unknown;
  /** Base64 puro ou data URL. */
  imagem?: unknown;
}

/** Assinaturas dos formatos aceitos — o mime declarado pelo cliente não vale nada. */
const FORMATOS: Array<{ mime: string; confere: (b: Buffer) => boolean }> = [
  { mime: 'image/jpeg', confere: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png',  confere: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/webp', confere: (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
];

/**
 * Produtos que o dono da farmácia manda pelo link (foto + nome). Cada farmácia
 * tem um espaço de no máximo LIMITE_PRODUTOS_CLIENTE; para mandar outro com o
 * espaço cheio, ele exclui um dos que já estão lá.
 */
export class ProdutoClienteService {
  constructor(
    private readonly espaco: EspacoDoCliente,
    private readonly farmacias: Pick<FarmaciaRepository, 'buscarAtiva'>,
    private readonly vitrine: VitrineDosClientes,
  ) {}

  /** Tudo o que os clientes da carteira mandaram; o admin vê todos os clientes. */
  daCarteira(quem: Gestor): Promise<ProdutoComCliente[]> {
    return this.vitrine.daCarteira(quem.isAdmin ? null : quem.id);
  }

  listar(farmaciaId: number): Promise<ProdutoDoCliente[]> {
    return this.espaco.listar(farmaciaId);
  }

  async enviar(farmaciaId: number, b: EnvioDeProduto | undefined): Promise<ProdutoDoCliente> {
    const nome = (typeof b?.nome === 'string' ? b.nome : '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (nome.length < 2) throw new RequisicaoInvalida('Informe o nome do produto.');
    const foto = this.lerFoto(b?.imagem);

    // Conferência antecipada só para a mensagem; quem garante é o banco.
    if (await this.espaco.contar(farmaciaId) >= LIMITE_PRODUTOS_CLIENTE) throw this.cheio();
    try {
      const produto = await this.espaco.criar(farmaciaId, { nome, ...foto });
      logger.info({ farmaciaId, produtoClienteId: produto.id }, 'Cliente enviou produto pelo link de ofertas');
      return produto;
    } catch (e) {
      if (e instanceof EspacoCheio) throw this.cheio();
      throw e;
    }
  }

  async foto(farmaciaId: number, id: number): Promise<FotoDoProduto> {
    const foto = Number.isFinite(id) ? await this.espaco.foto(farmaciaId, id) : null;
    if (!foto) throw new NaoEncontrado('Produto não encontrado');
    return foto;
  }

  async excluir(farmaciaId: number, id: number): Promise<void> {
    if (!Number.isFinite(id) || !(await this.espaco.excluir(farmaciaId, id))) {
      throw new NaoEncontrado('Produto não encontrado');
    }
  }

  /** Farmácia ativa e da carteira de quem pede (admin alcança todas). */
  async farmaciaDoGestor(quem: Gestor, farmaciaId: number): Promise<number> {
    const farmacia = Number.isFinite(farmaciaId) ? await this.farmacias.buscarAtiva(farmaciaId) : null;
    if (!farmacia) throw new NaoEncontrado('Farmácia não encontrada');
    if (!quem.isAdmin && farmacia.gestorId !== quem.id) throw new Proibido('Esta farmácia não é da sua carteira');
    return farmacia.id;
  }

  private lerFoto(bruto: unknown): { imagemB64: string; mime: string } {
    if (typeof bruto !== 'string' || !bruto) throw new RequisicaoInvalida('Envie a foto do produto.');
    const b64 = bruto.replace(/^data:[^;,]+;base64,/, '');
    const bytes = Buffer.from(b64, 'base64');
    if (bytes.length > MAX_BYTES_FOTO) throw new RequisicaoInvalida('A foto é grande demais. Tente outra.');

    const formato = FORMATOS.find((f) => f.confere(bytes));
    if (!formato) throw new RequisicaoInvalida('Formato de foto não aceito. Use JPG, PNG ou WEBP.');
    // Regrava a partir dos bytes: o que vai para o banco é base64 limpo.
    return { imagemB64: bytes.toString('base64'), mime: formato.mime };
  }

  private cheio(): Conflito {
    return new Conflito(
      `Você já enviou ${LIMITE_PRODUTOS_CLIENTE} produtos, o máximo permitido. Exclua um para enviar outro.`,
    );
  }
}
