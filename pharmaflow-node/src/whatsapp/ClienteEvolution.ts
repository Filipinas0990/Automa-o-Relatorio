import { logger } from '../logger';

const EVOLUTION_URL = () => process.env.EVOLUTION_API_URL || '';
const EVOLUTION_KEY = () => process.env.EVOLUTION_API_KEY || '';

/** Teto padrão de espera pela Evolution. Sem isso um request travado ali deixa
 *  o gestor com o spinner rodando para sempre, sem erro nenhum na tela. */
const TIMEOUT_PADRAO_MS = 30_000;

/**
 * Cliente HTTP cru da Evolution API (WhatsApp). Usado pelo WhatsappService e
 * injetado também no módulo de disparos em grupos, que fala com a mesma API.
 */
export class ClienteEvolution {
  async req<T = unknown>(
    method: string,
    path:   string,
    body?:  unknown,
    opts?:  { timeoutMs?: number },
  ): Promise<{ ok: boolean; status: number; data: T }> {
    const url = `${EVOLUTION_URL()}${path}`;
    const timeoutMs = opts?.timeoutMs ?? TIMEOUT_PADRAO_MS;

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          apikey:          EVOLUTION_KEY(),
        },
        body:   body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      // TimeoutError vem do AbortSignal.timeout; o resto é rede fora do ar.
      const expirou = err instanceof Error && err.name === 'TimeoutError';
      logger.error({ err, url, method, timeoutMs }, 'Evolution não respondeu');
      throw new Error(
        expirou
          ? `A Evolution API não respondeu em ${Math.round(timeoutMs / 1000)}s.`
          : 'Não foi possível falar com a Evolution API.',
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await res.json().catch(() => ({} as any));
    return { ok: res.ok, status: res.status, data: data as T };
  }
}
