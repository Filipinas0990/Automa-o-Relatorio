import { logger } from '../logger';
import { EnvioPorAmbiente, type PoliticaDeEnvio } from '../compartilhado/ModoEnvio';
import type { GrupoSelecionado, MidiaDisparo } from './types';

/**
 * Cliente do motor de disparo (repo `campaigns`).
 *
 * O campanhas é o motor de volume: recebe o disparo pronto (instância Evolution,
 * grupos, mensagem, mídias), enfileira e dispara pela Evolution, devolvendo o
 * status por grupo no `callbackUrl`. A autenticação entre os dois sistemas é um
 * segredo compartilhado (header `x-internal-key`).
 *
 * Se `CAMPAIGNS_API_URL` não estiver definida, o PharmaFlow mantém o envio
 * direto pela Evolution (fallback) — ver `DisparoService.executarDisparo`.
 */

export interface DisparoCampanhasPayload {
  disparoId: number;
  instance: string; // instância Evolution do gestor (ex.: "gestor_7")
  message?: string;
  groups: GrupoSelecionado[];
  medias?: MidiaDisparo[];
  callbackUrl?: string;
}

export class ClienteCampanhas {
  constructor(private readonly politica: PoliticaDeEnvio = new EnvioPorAmbiente()) {}

  /**
   * true quando o motor de campanhas está configurado para uso.
   *
   * No modo teste (ver compartilhado/ModoEnvio) o motor fica desligado mesmo
   * configurado: ele envia por conta própria, fora do alcance da trava do
   * ClienteEvolution. Sem ele o disparo cai no envio direto — que passa pela
   * trava e é simulado.
   */
  configurado(): boolean {
    return this.politica.envioReal() && Boolean(process.env.CAMPAIGNS_API_URL || '');
  }

  /** URL de callback que o campanhas deve chamar ao terminar (pode ser vazia). */
  callbackUrl(): string {
    return process.env.DISPARO_CALLBACK_URL || '';
  }

  /**
   * Enfileira o disparo no campanhas. Não aguarda o envio (que é assíncrono):
   * um 2xx significa apenas que o disparo foi aceito na fila. O resultado final
   * chega depois no callback.
   */
  async enfileirar(
    payload: DisparoCampanhasPayload,
  ): Promise<{ ok: boolean; status: number; data: unknown }> {
    // Defesa extra: quem chamar sem conferir configurado() não enfileira, e
    // recebe recusa (não sucesso) — para nada ser consumido como se tivesse saído.
    if (!this.politica.envioReal()) {
      logger.warn({ disparoId: payload.disparoId }, '[MODO TESTE] disparo NÃO enfileirado no motor de campanhas');
      return { ok: false, status: 503, data: { erro: 'modo teste: envio ao WhatsApp desligado neste processo' } };
    }

    const url = process.env.CAMPAIGNS_API_URL || '';
    const res = await fetch(`${url}/disparo`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-key': process.env.INTERNAL_API_KEY || '',
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
}
