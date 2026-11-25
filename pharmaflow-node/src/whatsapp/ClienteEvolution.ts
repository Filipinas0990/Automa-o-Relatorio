import { logger } from '../logger';
import { ehConsulta, EnvioPorAmbiente, VARIAVEL_ENVIO_REAL, type PoliticaDeEnvio } from '../compartilhado/ModoEnvio';

const EVOLUTION_URL = () => process.env.EVOLUTION_API_URL || '';
const EVOLUTION_KEY = () => process.env.EVOLUTION_API_KEY || '';

/** Teto padrão de espera pela Evolution. Sem isso um request travado ali deixa
 *  o gestor com o spinner rodando para sempre, sem erro nenhum na tela. */
const TIMEOUT_PADRAO_MS = 30_000;

/**
 * Cliente HTTP cru da Evolution API (WhatsApp). Usado pelo WhatsappService e
 * injetado também no módulo de disparos em grupos, que fala com a mesma API.
 *
 * É o ÚNICO caminho do PharmaFlow até o WhatsApp — por isso a trava de envio
 * (ver compartilhado/ModoEnvio) mora aqui: no modo teste, o que não é consulta
 * não sai, e quem chamou recebe uma resposta de sucesso marcada `modoTeste`.
 */
export class ClienteEvolution {
  constructor(private readonly politica: PoliticaDeEnvio = new EnvioPorAmbiente()) {}

  async req<T = unknown>(
    method: string,
    path:   string,
    body?:  unknown,
    opts?:  { timeoutMs?: number },
  ): Promise<{ ok: boolean; status: number; data: T }> {
    if (!this.politica.envioReal() && !ehConsulta(method, path)) {
      return this.simular<T>(method, path, body);
    }

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

  /**
   * Modo teste: registra o que TERIA ido para o WhatsApp e responde sucesso,
   * para o fluxo da tela seguir igual ao de produção. O log diz o destino e o
   * tipo — nunca a imagem (base64 de MB) nem o texto inteiro.
   */
  private simular<T>(method: string, path: string, body: unknown): { ok: boolean; status: number; data: T } {
    const corpo = (body ?? {}) as { number?: string; mediatype?: string; caption?: string; text?: string };
    logger.warn(
      {
        method, path,
        destino: corpo.number,
        tipo:    corpo.mediatype ?? (corpo.text !== undefined ? 'texto' : undefined),
        trecho:  (corpo.caption ?? corpo.text ?? '').slice(0, 60) || undefined,
      },
      `[MODO TESTE] não enviado ao WhatsApp — ${VARIAVEL_ENVIO_REAL} não está "true" neste processo`,
    );
    return { ok: true, status: 200, data: { modoTeste: true, key: { id: 'MODO-TESTE' } } as T };
  }
}
