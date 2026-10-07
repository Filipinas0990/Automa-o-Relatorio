import type { Gestor } from '../database/schema';
import type { HashSenha } from '../compartilhado/HashSenha';
import {
  Conflito, Indisponivel, MuitasTentativas, NaoAutorizado, Proibido, RequisicaoInvalida,
} from '../compartilhado/erros';
import type { GestorRepository } from '../gestores/GestorRepository';
import type { LimitadorLogin } from './LimitadorLogin';

export interface DadosSuperAdmin {
  nome: string;
  email: string;
  senha: string;
  admin_secret: string;
}

/** Regras de entrada no sistema: login e criação do primeiro admin. */
export class AuthService {
  constructor(
    private readonly gestores: GestorRepository,
    private readonly hash: HashSenha,
    private readonly limitador: LimitadorLogin,
    private readonly adminSecret: string,
  ) {}

  /** Confere email e senha e devolve o gestor. Quem abre a sessão é o controller. */
  async login(email: string | undefined, senha: string | undefined): Promise<Gestor> {
    if (!email || !senha) throw new RequisicaoInvalida('Informe email e senha');

    const espera = this.limitador.esperaPara(email);
    if (espera) {
      throw new MuitasTentativas(`Muitas tentativas erradas. Tente de novo em ${Math.ceil(espera / 60)} min.`, espera);
    }

    const gestor = await this.gestores.buscarPorEmail(email);
    if (!gestor || !await this.hash.confere(senha, gestor.senhaHash)) {
      this.limitador.registrarFalha(email);
      throw new NaoAutorizado('Email ou senha incorretos');
    }
    if (!gestor.ativo) throw new Proibido('Usuário inativo');

    this.limitador.limpar(email);
    return gestor;
  }

  /** Só funciona enquanto não existe nenhum admin, e exige o ADMIN_SECRET do servidor. */
  async criarSuperAdmin(dados: DadosSuperAdmin): Promise<Gestor> {
    if (!this.adminSecret)                        throw new Indisponivel('ADMIN_SECRET não configurado');
    if (dados.admin_secret !== this.adminSecret)  throw new Proibido('Segredo inválido');
    if (await this.gestores.existeAdmin())        throw new Conflito('Super admin já existe. Use o login normal.');
    if (await this.gestores.buscarPorEmail(dados.email)) throw new Conflito('Email já cadastrado');

    return this.gestores.criar({
      nome: dados.nome, email: dados.email, senhaHash: await this.hash.gerar(dados.senha), isAdmin: true,
    });
  }
}
