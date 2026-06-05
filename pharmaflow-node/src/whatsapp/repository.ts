import { eq, sql } from 'drizzle-orm';
import { db } from '../database/db';
import { whatsappConfig, reunioes } from '../database/schema';
import type { WhatsAppConfig } from '../database/schema';

export type WhatsAppStatus = 'open' | 'close' | 'connecting';

// ── Config da instância ───────────────────────────────────────────────────────

export const whatsappRepository = {

  async getConfig(): Promise<WhatsAppConfig | null> {
    const [row] = await db.select().from(whatsappConfig).limit(1);
    return row ?? null;
  },

  async salvarConfig(data: {
    instanceName:    string;
    status:          WhatsAppStatus;
    qrCode?:         string | null;
    numeroConectado?: string | null;
  }): Promise<WhatsAppConfig> {
    const [existente] = await db.select({ id: whatsappConfig.id })
      .from(whatsappConfig).limit(1);

    if (existente) {
      const [atualizado] = await db.update(whatsappConfig).set({
        instanceName:    data.instanceName,
        status:          data.status,
        qrCode:          data.qrCode          ?? null,
        numeroConectado: data.numeroConectado  ?? null,
        atualizadoEm:    new Date(),
      }).where(eq(whatsappConfig.id, existente.id)).returning();
      return atualizado;
    }

    const [criado] = await db.insert(whatsappConfig).values({
      instanceName:    data.instanceName,
      status:          data.status,
      qrCode:          data.qrCode          ?? null,
      numeroConectado: data.numeroConectado  ?? null,
    }).returning();
    return criado;
  },

  async atualizarStatus(
    id:              number,
    status:          WhatsAppStatus,
    qrCode?:         string | null,
    numeroConectado?: string | null,
  ): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const campos: Record<string, any> = { status, atualizadoEm: new Date() };
    if (qrCode          !== undefined) campos.qrCode          = qrCode;
    if (numeroConectado !== undefined) campos.numeroConectado = numeroConectado;

    await db.update(whatsappConfig).set(campos).where(eq(whatsappConfig.id, id));
  },

  async deletarConfig(id: number): Promise<void> {
    await db.delete(whatsappConfig).where(eq(whatsappConfig.id, id));
  },

  // ── Reuniões — usado pelo scheduler ────────────────────────────────────────

  async buscarReunioesPara5h() {
    const agora     = new Date();
    const limiteIni = new Date(agora.getTime() + (5 * 60 - 5) * 60_000);  // +4h55m
    const limiteFim = new Date(agora.getTime() + (5 * 60 + 5) * 60_000);  // +5h05m

    const { rows } = await db.execute(sql`
      SELECT
        r.id,
        r.titulo,
        r.data_reuniao,
        r.duracao_minutos,
        r.local,
        r.link_meet,
        r.telefone,
        f.nome AS farmacia_nome
      FROM reunioes r
      JOIN farmacias f ON f.id = r.farmacia_id
      WHERE r.status IN ('agendada', 'confirmada')
        AND r.whatsapp_notificado_em IS NULL
        AND r.data_reuniao >= ${limiteIni.toISOString()}::timestamptz
        AND r.data_reuniao <  ${limiteFim.toISOString()}::timestamptz
        AND r.telefone IS NOT NULL
        AND r.telefone <> ''
    `);
    return rows as {
      id:              unknown;
      titulo:          unknown;
      data_reuniao:    unknown;
      duracao_minutos: unknown;
      local:           unknown;
      link_meet:       unknown;
      telefone:        unknown;
      farmacia_nome:   unknown;
    }[];
  },

  async marcarNotificacaoEnviada(reuniaoId: number): Promise<void> {
    await db.update(reunioes)
      .set({ whatsappNotificadoEm: new Date() })
      .where(eq(reunioes.id, reuniaoId));
  },
};
