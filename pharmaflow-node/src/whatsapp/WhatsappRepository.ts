import { eq, sql } from 'drizzle-orm';
import { whatsappConfig, reunioes } from '../database/schema';
import type { WhatsAppConfig } from '../database/schema';
import type { BancoDeDados } from '../compartilhado/tipos';

export type WhatsAppStatus = 'open' | 'close' | 'connecting';

/** Acesso às conexões WhatsApp (Evolution API) e à notificação de reuniões. */
export class WhatsappRepository {
  constructor(private readonly db: BancoDeDados) {}

  /** Conexão "default" (a mais antiga) — usada pelas notificações de reunião. */
  async getConfig(): Promise<WhatsAppConfig | null> {
    const [row] = await this.db.select().from(whatsappConfig)
      .orderBy(whatsappConfig.id).limit(1);
    return row ?? null;
  }

  /** Todas as conexões globais (a tela Conexões lista várias). */
  async listConfigs(): Promise<WhatsAppConfig[]> {
    return this.db.select().from(whatsappConfig).orderBy(whatsappConfig.id);
  }

  async getConfigByInstance(instanceName: string): Promise<WhatsAppConfig | null> {
    const [row] = await this.db.select().from(whatsappConfig)
      .where(eq(whatsappConfig.instanceName, instanceName)).limit(1);
    return row ?? null;
  }

  async salvarConfig(data: {
    instanceName:    string;
    status:          WhatsAppStatus;
    qrCode?:         string | null;
    numeroConectado?: string | null;
    nome?:           string | null;
  }): Promise<WhatsAppConfig> {
    // Upsert POR instância — cada conexão distinta é a sua própria linha
    // (é o que permite ter várias conexões globais).
    const [existente] = await this.db.select({ id: whatsappConfig.id })
      .from(whatsappConfig)
      .where(eq(whatsappConfig.instanceName, data.instanceName))
      .limit(1);

    if (existente) {
      const [atualizado] = await this.db.update(whatsappConfig).set({
        status:          data.status,
        qrCode:          data.qrCode          ?? null,
        numeroConectado: data.numeroConectado  ?? null,
        ...(data.nome !== undefined ? { nome: data.nome } : {}),
        atualizadoEm:    new Date(),
      }).where(eq(whatsappConfig.id, existente.id)).returning();
      return atualizado;
    }

    const [criado] = await this.db.insert(whatsappConfig).values({
      instanceName:    data.instanceName,
      status:          data.status,
      qrCode:          data.qrCode          ?? null,
      numeroConectado: data.numeroConectado  ?? null,
      nome:            data.nome ?? null,
    }).returning();
    return criado;
  }

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

    await this.db.update(whatsappConfig).set(campos).where(eq(whatsappConfig.id, id));
  }

  async deletarConfig(id: number): Promise<void> {
    await this.db.delete(whatsappConfig).where(eq(whatsappConfig.id, id));
  }

  // ── Reuniões — usado pelo scheduler ────────────────────────────────────────

  async buscarReunioesPara5h() {
    const agora     = new Date();
    const limiteIni = new Date(agora.getTime() + (5 * 60 - 5) * 60_000);  // +4h55m
    const limiteFim = new Date(agora.getTime() + (5 * 60 + 5) * 60_000);  // +5h05m

    const { rows } = await this.db.execute(sql`
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
  }

  async marcarNotificacaoEnviada(reuniaoId: number): Promise<void> {
    await this.db.update(reunioes)
      .set({ whatsappNotificadoEm: new Date() })
      .where(eq(reunioes.id, reuniaoId));
  }

  /**
   * Reuniões que começam nos próximos 5 minutos e ainda não receberam o aviso.
   * A janela vai de "agora" até +5min: o scheduler roda a cada minuto, então a
   * reunião entra no primeiro tique depois de faltar 5 minutos. Reunião criada
   * em cima da hora (faltando 3 min, por ex.) também recebe — ainda é útil.
   */
  async buscarReunioesPara5min() {
    const agora     = new Date();
    const limiteFim = new Date(agora.getTime() + 5 * 60_000);

    const { rows } = await this.db.execute(sql`
      SELECT
        r.id,
        r.titulo,
        r.data_reuniao,
        -- A tela de agendar não pede telefone: sem número na reunião, vale o
        -- telefone da farmácia (o mesmo do botão "Abrir WhatsApp")
        COALESCE(NULLIF(TRIM(r.telefone), ''), NULLIF(TRIM(f.telefone), '')) AS telefone
      FROM reunioes r
      JOIN farmacias f ON f.id = r.farmacia_id
      WHERE r.status IN ('agendada', 'confirmada')
        AND r.whatsapp_aviso_5min_em IS NULL
        AND r.data_reuniao >  ${agora.toISOString()}::timestamptz
        AND r.data_reuniao <= ${limiteFim.toISOString()}::timestamptz
        AND COALESCE(NULLIF(TRIM(r.telefone), ''), NULLIF(TRIM(f.telefone), '')) IS NOT NULL
    `);
    return rows as {
      id:           unknown;
      titulo:       unknown;
      data_reuniao: unknown;
      telefone:     unknown;
    }[];
  }

  async marcarAviso5minEnviado(reuniaoId: number): Promise<void> {
    await this.db.update(reunioes)
      .set({ whatsappAviso5minEm: new Date() })
      .where(eq(reunioes.id, reuniaoId));
  }
}
