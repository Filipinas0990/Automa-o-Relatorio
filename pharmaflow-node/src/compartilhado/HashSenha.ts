import bcrypt from 'bcrypt';

/** Gera e confere o hash das senhas dos gestores. */
export class HashSenha {
  constructor(private readonly custo = 10) {}

  gerar(senha: string): Promise<string> {
    return bcrypt.hash(senha, this.custo);
  }

  confere(senha: string, hash: string): Promise<boolean> {
    return bcrypt.compare(senha, hash);
  }
}
