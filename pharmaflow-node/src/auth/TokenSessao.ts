import jwt from 'jsonwebtoken';

const SEGREDO_MINIMO = 32;

/** Sem segredo forte o servidor não sobe: assinar com um valor padrão deixaria qualquer um forjar tokens. */
export function lerSegredoJwt(): string {
  const segredo = (process.env.JWT_SECRET_KEY ?? '').trim();
  if (segredo.length < SEGREDO_MINIMO) {
    throw new Error(
      `JWT_SECRET_KEY ausente ou curta demais (mínimo ${SEGREDO_MINIMO} caracteres). ` +
      'Gere uma com: openssl rand -base64 48',
    );
  }
  return segredo;
}

export interface PayloadSessao {
  sub: string;
  nome: string;
  is_admin: boolean;
  /** Momento do login (segundos). Não muda nas renovações. */
  ini: number;
  iat: number;
  exp: number;
}

interface DonoDaSessao {
  id: number;
  nome: string;
  isAdmin: boolean;
}

/** Sem uso por esse tempo, a sessão expira. */
export const INATIVIDADE_SEG = 8 * 60 * 60;
/** Renova no máximo uma vez a cada 30 min, não a cada pedido. */
const RENOVAR_APOS_SEG = 30 * 60;
/** Mesmo em uso contínuo, pede login de novo depois de 7 dias. */
const VIDA_MAXIMA_SEG = 7 * 24 * 60 * 60;

function agora(): number {
  return Math.floor(Date.now() / 1000);
}

/** Emite, confere e renova o JWT da sessão do gestor. */
export class TokenSessao {
  constructor(private readonly segredo: string) {}

  emitir(gestor: DonoDaSessao, ini = agora()): string {
    return jwt.sign(
      { sub: String(gestor.id), nome: gestor.nome, is_admin: gestor.isAdmin, ini },
      this.segredo,
      { expiresIn: INATIVIDADE_SEG },
    );
  }

  verificar(token: string): PayloadSessao {
    const p = jwt.verify(token, this.segredo) as PayloadSessao & { uso?: string };
    // Um state de OAuth é assinado com o mesmo segredo, mas não é sessão.
    if (p.uso) throw new Error('token não é de sessão');
    return p;
  }

  /**
   * Renovação deslizante: quem está usando o sistema não cai no meio do
   * trabalho. Devolve o token novo, ou null se ainda não é hora (ou se a
   * vida máxima já passou).
   */
  renovar(p: PayloadSessao): string | null {
    const t = agora();
    const ini = p.ini ?? p.iat;
    if (t - p.iat < RENOVAR_APOS_SEG) return null;
    if (t - ini > VIDA_MAXIMA_SEG) return null;
    return this.emitir({ id: parseInt(p.sub, 10), nome: p.nome, isAdmin: p.is_admin }, ini);
  }
}
