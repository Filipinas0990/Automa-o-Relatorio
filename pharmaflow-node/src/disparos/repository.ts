import { and, eq, lte, desc, sql } from 'drizzle-orm';
import { db } from '../database/db';
import { gestorWhatsapp, disparosGrupo, disparosGrupoLog } from '../database/schema';
import type { GestorWhatsapp, DisparoGrupo } from '../database/schema';

export type InstanciaStatus = 'open' | 'close' | 'connecting';

export const disparosRepository = {

  // ── Instância Evolution do gestor ──────────────────────────────────────────

  async getInstancia(gestorId: number): Promise<GestorWhatsapp | null> {
    const [row] = await db.select().from(gestorWhatsapp)
      .where(eq(gestorWhatsapp.gestorId, gestorId));
    return row ?? null;
  },

  async criarInstancia(data: {
    gestorId:     number;
    instanceName: string;
    status:       InstanciaStatus;
    qrCode:       string | null;
  }): Promise<GestorWhatsapp> {
    const [row] = await db.insert(gestorWhatsapp).values(data).returning();
    return row;
  },

  async atualizarInstancia(
    id:     number,
    campos: Partial<{ status: InstanciaStatus; qrCode: string | null; numeroConectado: string | null }>,
  ): Promise<void> {
    await db.update(gestorWhatsapp)
      .set({ ...campos, atualizadoEm: sql`NOW()` })
      .where(eq(gestorWhatsapp.id, id));
  },

  // ── Disparos ───────────────────────────────────────────────────────────────

  async criarDisparo(data: {
    gestorId:      number;
    titulo:        string;
    mensagem:      string;
    midiasJson:    string | null;
    farmaciaId:    number | null;
    solicitacaoId: number | null;
    gruposJson:   string;
    quando:       'agora' | 'agendado';
    agendadoPara: Date | null;
    repetir:      'nunca' | 'diario' | 'semanal' | 'mensal';
    timezone:     string;
    status:       string;
    proximoEnvio: Date | null;
  }): Promise<DisparoGrupo> {
    const [row] = await db.insert(disparosGrupo).values(data).returning();
    return row;
  },

  async getDisparo(id: number): Promise<DisparoGrupo | null> {
    const [row] = await db.select().from(disparosGrupo).where(eq(disparosGrupo.id, id));
    return row ?? null;
  },

  /** Disparos do gestor, mais recentes primeiro. */
  async listarDisparos(gestorId: number): Promise<DisparoGrupo[]> {
    return db.select().from(disparosGrupo)
      .where(eq(disparosGrupo.gestorId, gestorId))
      .orderBy(desc(disparosGrupo.criadoEm))
      .limit(100);
  },

  /** Agendados cuja hora já chegou — usado pelo scheduler. */
  async buscarDisparosPendentes(agora: Date): Promise<DisparoGrupo[]> {
    return db.select().from(disparosGrupo).where(
      and(
        eq(disparosGrupo.status, 'agendado'),
        lte(disparosGrupo.proximoEnvio, agora),
      ),
    );
  },

  async atualizarDisparo(
    id:     number,
    campos: Partial<{ status: string; proximoEnvio: Date | null; ultimoEnvio: Date | null }>,
  ): Promise<void> {
    await db.update(disparosGrupo)
      .set({ ...campos, atualizadoEm: sql`NOW()` })
      .where(eq(disparosGrupo.id, id));
  },

  async registrarLog(data: {
    disparoId: number;
    grupoJid:  string;
    grupoNome: string | null;
    status:    'ok' | 'erro';
    erro:      string | null;
  }): Promise<void> {
    await db.insert(disparosGrupoLog).values(data);
  },

  async logsDoDisparo(disparoId: number) {
    return db.select().from(disparosGrupoLog)
      .where(eq(disparosGrupoLog.disparoId, disparoId))
      .orderBy(desc(disparosGrupoLog.enviadoEm));
  },
};
