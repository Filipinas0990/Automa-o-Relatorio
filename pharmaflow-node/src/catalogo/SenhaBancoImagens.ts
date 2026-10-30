import { randomBytes, scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import type { Middleware } from '../auth/Autenticador';
import type { LimitadorLogin } from '../auth/LimitadorLogin';

const scryptAsync = promisify(scrypt) as (senha: string, sal: Buffer, tamanho: number) => Promise<Buffer>;

/** Cabeçalho onde o front manda a senha do banco (codificada com encodeURIComponent). */
export const CABECALHO_SENHA = 'x-senha-banco';

const TAMANHO_HASH = 64;

/**
 * Gera o valor de BANCO_IMAGENS_SENHA_HASH. Formato `scrypt:<sal>:<hash>` em
 * hex — sem `$`, para o docker compose não tentar interpolar o valor do .env.
 */
export async function gerarHashSenhaBanco(senha: string): Promise<string> {
  const sal = randomBytes(16);
  const hash = await scryptAsync(senha, sal, TAMANHO_HASH);
  return `scrypt:${sal.toString('hex')}:${hash.toString('hex')}`;
}

/** O que o controller precisa: um preHandler que barra a ação sem a senha certa. */
export interface GuardaSenhaBanco {
  readonly exigirSenha: Middleware;
}

/**
 * Segunda trava das ações do Banco de Imagens: além de ser admin, toda escrita
 * (e o download) exige a senha definida UMA vez no servidor, em
 * BANCO_IMAGENS_SENHA_HASH. Não fica no banco de dados de propósito — quem tem
 * acesso ao sistema não consegue trocá-la; só quem mexe no servidor.
 *
 * Senha errada responde 403 (não 401): 401 faz o front deslogar o admin.
 * Sem a variável configurada, tudo fica bloqueado (503) em vez de liberado.
 */
export class SenhaBancoImagens implements GuardaSenhaBanco {
  private readonly configurada: { sal: Buffer; hash: Buffer } | null;

  constructor(
    hashConfigurado: string | undefined,
    private readonly limitador: LimitadorLogin,
  ) {
    this.configurada = SenhaBancoImagens.lerHash(hashConfigurado);
  }

  readonly exigirSenha: Middleware = async (request, reply) => {
    if (!this.configurada) {
      reply.code(503).send({ detail: 'A senha do banco de imagens não foi configurada no servidor.' });
      return;
    }

    // Contado por gestor, não por IP: atrás do proxy da Vercel o IP é sempre o dela.
    const chave = `banco-imagens:${request.user?.id ?? 'anonimo'}`;
    const espera = this.limitador.esperaPara(chave);
    if (espera > 0) {
      reply.code(429).header('Retry-After', String(espera)).send({
        detail: `Muitas tentativas com a senha errada. Tente de novo em ${Math.ceil(espera / 60)} min.`,
      });
      return;
    }

    const senha = SenhaBancoImagens.lerCabecalho(request.headers[CABECALHO_SENHA]);
    if (!senha || !await this.confere(senha)) {
      this.limitador.registrarFalha(chave);
      reply.code(403).send({ detail: 'Senha do banco de imagens incorreta.', codigo: 'senha_banco' });
      return;
    }
    this.limitador.limpar(chave);
  };

  private async confere(senha: string): Promise<boolean> {
    const { sal, hash } = this.configurada!;
    const tentativa = await scryptAsync(senha, sal, hash.length);
    return timingSafeEqual(tentativa, hash);
  }

  private static lerCabecalho(valor: string | string[] | undefined): string | null {
    if (typeof valor !== 'string' || !valor) return null;
    try {
      return decodeURIComponent(valor);
    } catch {
      return null;
    }
  }

  private static lerHash(valor: string | undefined): { sal: Buffer; hash: Buffer } | null {
    const partes = valor?.trim().split(':');
    if (!partes || partes.length !== 3 || partes[0] !== 'scrypt') return null;
    const sal = Buffer.from(partes[1], 'hex');
    const hash = Buffer.from(partes[2], 'hex');
    return sal.length > 0 && hash.length > 0 ? { sal, hash } : null;
  }
}
