import crypto from 'crypto';
import { ofertasRepository } from './repository';

/** Token do link público — aleatório, longo o bastante para não ser adivinhado. */
export function gerarToken(): string {
  return crypto.randomBytes(24).toString('hex');
}

/**
 * URL que o gestor copia e manda para o dono da farmácia.
 *
 * `OFERTAS_URL_BASE` existe para testar local sem mexer no `FRONTEND_URL`, que
 * também é usado nos links de produção. Em produção basta não definir a
 * variável — aí cai no FRONTEND_URL normalmente.
 */
export function montarUrl(token: string): string {
  const base = (
    process.env.OFERTAS_URL_BASE
    || process.env.FRONTEND_URL
    || 'http://localhost:5173'
  ).replace(/\/$/, '');
  return `${base}/ofertas/${token}`;
}

export const ofertasService = {

  /** Link do gestor, criando na primeira vez que ele pede. */
  async obterOuCriarLink(gestorId: number) {
    const existente = await ofertasRepository.getLink(gestorId);
    if (existente) {
      return { token: existente.token, url: montarUrl(existente.token) };
    }

    const novo = await ofertasRepository.criarLink(gestorId, gerarToken());
    return { token: novo.token, url: montarUrl(novo.token) };
  },

  /** Troca o token — o link antigo para de funcionar na hora. */
  async regenerarLink(gestorId: number) {
    const existente = await ofertasRepository.getLink(gestorId);
    if (!existente) return this.obterOuCriarLink(gestorId);

    const atualizado = await ofertasRepository.trocarToken(existente.id, gerarToken());
    return { token: atualizado.token, url: montarUrl(atualizado.token) };
  },
};
