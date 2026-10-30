import jwt from 'jsonwebtoken';

/**
 * `state` assinado do OAuth (Google, Facebook).
 *
 * Antes o state do Google era só o id do gestor em base64: qualquer um podia
 * montar um state com o id de outra pessoa e ligar a própria conta à agenda
 * dela. Agora vai assinado, marcado com o uso e vale 10 minutos.
 */
export class StateOAuth {
  constructor(
    private readonly segredo: string,
    private readonly uso: string,
  ) {}

  criar(gestorId: number): string {
    return jwt.sign({ sub: String(gestorId), uso: this.uso }, this.segredo, { expiresIn: '10m' });
  }

  /** Id do gestor que pediu o OAuth, ou null se o state for falso, vencido ou de outro uso. */
  ler(state: string): number | null {
    try {
      const p = jwt.verify(state, this.segredo) as { sub: string; uso?: string };
      if (p.uso !== this.uso) return null;
      const id = parseInt(p.sub, 10);
      return Number.isFinite(id) && id > 0 ? id : null;
    } catch {
      return null;
    }
  }
}
