import { logger } from '../logger';
import type { GrupoSelecionado, MidiaDisparo } from './service';

/**
 * Cliente do motor de disparo (repo `campaigns`).
 *
 * O campanhas é o motor de volume: recebe o disparo pronto (instância Evolution,
 * grupos, mensagem, mídias), enfileira e dispara pela Evolution, devolvendo o
 * status por grupo no `callbackUrl`. A autenticação entre os dois sistemas é um
 * segredo compartilhado (header `x-internal-key`).
 *
 * Se `CAMPAIGNS_API_URL` não estiver definida, o PharmaFlow mantém o envio
 * direto pela Evolution (fallback) — ver `disparosService.executarDisparo`.
 */

const CAMPAIGNS_URL = () => process.env.CAMPAIGNS_API_URL || '';
const INTERNAL_KEY = () => process.env.INTERNAL_API_KEY || '';
const CALLBACK_URL = () => process.env.DISPARO_CALLBACK_URL || '';

/** true quando o motor de campanhas está configurado para uso. */
export function campanhasConfigurado(): boolean {
  return Boolean(CAMPAIGNS_URL());
}

/** URL de callback que o campanhas deve chamar ao terminar (pode ser vazia). */
export function callbackUrl(): string {
  return CALLBACK_URL();
}

export interface DisparoCampanhasPayload {
  disparoId: number;
  instance: string; // instância Evolution do gestor (ex.: "gestor_7")
  message?: string;
  groups: GrupoSelecionado[];
  medias?: MidiaDisparo[];
  callbackUrl?: string;
}

/**
 * Enfileira o disparo no campanhas. Não aguarda o envio (que é assíncrono):
 * um 2xx significa apenas que o disparo foi aceito na fila. O resultado final
 * chega depois no callback.
 */
export async function enfileirarDisparoNoCampanhas(
  payload: DisparoCampanhasPayload,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(`${CAMPAIGNS_URL()}/disparo`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-key': INTERNAL_KEY(),
    },
    body: JSON.stringify(payload),
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await res.json().catch(() => ({} as any));

  if (!res.ok) {
    logger.error(
      { disparoId: payload.disparoId, status: res.status, data },
      'Falha ao enfileirar disparo no campanhas',
    );
  }

  return { ok: res.ok, status: res.status, data };
}
