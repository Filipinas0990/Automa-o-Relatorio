import type { Gestor } from '../database/schema';
import type { HashSenha } from '../compartilhado/HashSenha';
import { Conflito, NaoEncontrado, RequisicaoInvalida } from '../compartilhado/erros';
import type { GestorComContagem, GestorRepository, NovoGestor } from './GestorRepository';

export interface DadosGestor {
  nome?: string;
  email?: string;
  senha?: string;
}

/** Regras do cadastro de gestores. */
export class GestorService {
  constructor(
    private readonly gestores: GestorRepository,
    private readonly hash: HashSenha,
  ) {}

  /**
   * Admin vê todos; gestor comum vê só a si mesmo (as telas que listam
   * gestores continuam funcionando, sem expor nome e email dos colegas).
   */
  listarVisiveisPara(quem: Gestor): Promise<GestorComContagem[]> {
    return this.gestores.listarAtivosComContagem(quem.isAdmin ? undefined : quem.id);
  }

  async criar(dados: { nome: string; email: string; senha: string }): Promise<Gestor> {
    if (await this.gestores.buscarPorEmail(dados.email)) throw new Conflito('Email já cadastrado');
    return this.gestores.criar({
      nome: dados.nome, email: dados.email, senhaHash: await this.hash.gerar(dados.senha), isAdmin: false,
    });
  }

  /** Só muda os campos preenchidos; senha vazia mantém a atual. */
  async atualizar(id: number, dados: DadosGestor): Promise<Gestor> {
    if (!await this.gestores.buscarPorId(id)) throw new NaoEncontrado('Gestor não encontrado');

    const mudancas: Partial<NovoGestor> = {};
    if (dados.nome)  mudancas.nome      = dados.nome;
    if (dados.email) mudancas.email     = dados.email;
    if (dados.senha) mudancas.senhaHash = await this.hash.gerar(dados.senha);
    await this.gestores.atualizar(id, mudancas);

    return (await this.gestores.buscarPorId(id))!;
  }

  /** Desativa, não apaga: farmácias e histórico continuam apontando para ele. */
  async desativar(id: number, quem: Gestor): Promise<void> {
    if (id === quem.id) throw new RequisicaoInvalida('Não é possível deletar seu próprio usuário');
    if (!await this.gestores.buscarPorId(id)) throw new NaoEncontrado('Gestor não encontrado');
    await this.gestores.desativar(id);
  }
}
