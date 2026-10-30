import type { calendar_v3 } from 'googleapis';
import type { Gestor, Reuniao } from '../database/schema';
import type { GestorRepository } from '../gestores/GestorRepository';
import type { ReuniaoRepository } from '../reunioes/ReuniaoRepository';
import type { ClienteGoogleOAuth } from './ClienteGoogleOAuth';

/**
 * Espelha as reuniões no Google Calendar do gestor que conectou a conta.
 * Sem integração configurada ou sem conta conectada, não faz nada.
 */
export class AgendaGoogle {
  constructor(
    private readonly cliente: ClienteGoogleOAuth,
    private readonly gestores: GestorRepository,
    private readonly reunioes: ReuniaoRepository,
  ) {}

  get configurado(): boolean {
    return this.cliente.configurado;
  }

  /** Cria (ou atualiza) o evento da reunião. Devolve o id do evento, ou null se não sincronizou. */
  async sincronizar(gestorId: number, reuniaoId: number): Promise<string | null> {
    const contexto = await this.contexto(gestorId, reuniaoId);
    if (!contexto) return null;
    const { gestor, reuniao } = contexto;

    const cal        = this.cliente.calendario(gestor.googleRefreshToken!);
    const calendarId = gestor.googleCalendarId ?? 'primary';
    const evento     = this.evento(reuniao);

    let eventId = reuniao.googleEventId;
    if (eventId) {
      try {
        await cal.events.update({ calendarId, eventId, requestBody: evento });
      } catch {
        // Apagado lá no Google: cria de novo
        eventId = (await cal.events.insert({ calendarId, requestBody: evento })).data.id ?? null;
      }
    } else {
      eventId = (await cal.events.insert({ calendarId, requestBody: evento })).data.id ?? null;
    }

    if (eventId) await this.reunioes.gravarEventoGoogle(reuniaoId, eventId);
    return eventId;
  }

  async remover(gestorId: number, reuniaoId: number): Promise<void> {
    const contexto = await this.contexto(gestorId, reuniaoId);
    const eventId  = contexto?.reuniao.googleEventId;
    if (!contexto || !eventId) return;

    try {
      await this.cliente.calendario(contexto.gestor.googleRefreshToken!).events.delete({
        calendarId: contexto.gestor.googleCalendarId ?? 'primary',
        eventId,
      });
    } catch { /* ignora se já foi deletado */ }
  }

  private async contexto(gestorId: number, reuniaoId: number): Promise<{ gestor: Gestor; reuniao: Reuniao } | null> {
    if (!this.cliente.configurado) return null;
    const gestor = await this.gestores.buscarPorId(gestorId);
    if (!gestor?.googleRefreshToken) return null;
    const reuniao = await this.reunioes.buscarPorId(reuniaoId);
    return reuniao ? { gestor, reuniao } : null;
  }

  private evento(r: Reuniao): calendar_v3.Schema$Event {
    const inicio = new Date(r.dataReuniao);
    const fim    = new Date(inicio.getTime() + (r.duracaoMinutos ?? 60) * 60_000);
    return {
      summary:     r.titulo,
      description: [r.descricao, r.linkMeet ? `Link: ${r.linkMeet}` : ''].filter(Boolean).join('\n'),
      location:    r.local ?? undefined,
      start: { dateTime: inicio.toISOString() },
      end:   { dateTime: fim.toISOString()    },
    };
  }
}
