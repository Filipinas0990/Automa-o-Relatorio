/**
 * Limite de tentativas de login.
 *
 * Contado por e-mail, não por IP: atrás do proxy da Vercel todo pedido chega
 * com o IP da Vercel, e limitar por IP bloquearia todo mundo junto.
 * Em memória: reiniciar o servidor zera a contagem, o que é aceitável aqui.
 */
export class LimitadorLogin {
  private readonly falhas = new Map<string, { qtd: number; desde: number }>();

  constructor(
    private readonly maxFalhas = 5,
    private readonly janelaMs = 15 * 60 * 1000,
  ) {}

  /** Segundos até liberar, ou 0 se pode tentar. */
  esperaPara(email: string): number {
    const k = this.chave(email);
    const f = this.falhas.get(k);
    if (!f) return 0;
    const passou = Date.now() - f.desde;
    if (passou > this.janelaMs) { this.falhas.delete(k); return 0; }
    return f.qtd >= this.maxFalhas ? Math.ceil((this.janelaMs - passou) / 1000) : 0;
  }

  registrarFalha(email: string): void {
    const k = this.chave(email);
    const f = this.falhas.get(k);
    if (!f || Date.now() - f.desde > this.janelaMs) this.falhas.set(k, { qtd: 1, desde: Date.now() });
    else f.qtd += 1;
  }

  limpar(email: string): void {
    this.falhas.delete(this.chave(email));
  }

  private chave(email: string): string {
    return email.trim().toLowerCase();
  }
}
