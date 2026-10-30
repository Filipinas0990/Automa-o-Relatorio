import type { Gestor } from '../database/schema';
import type { HashSenha } from '../compartilhado/HashSenha';
import { MuitasTentativas, NaoAutorizado, Proibido, RequisicaoInvalida } from '../compartilhado/erros';
import type { GestorRepository } from '../gestores/GestorRepository';
import type { LimitadorLogin } from './LimitadorLogin';

/**
 * Regras de entrada no sistema: só login. De propósito sem autocadastro —
 * gestor novo é criado por um admin já logado (ver GestorService.criar).
 */
export class AuthService {
  constructor(
    private readonly gestores: GestorRepository,
    private readonly hash: HashSenha,
    private readonly limitador: LimitadorLogin,
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
}
