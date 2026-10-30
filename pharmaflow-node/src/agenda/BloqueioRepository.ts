import { eq, sql } from 'drizzle-orm';
import { agendaBloqueios } from '../database/schema';
import type { AgendaBloqueio } from '../database/schema';
import type { BancoDeDados, Linha } from '../compartilhado/tipos';

export type NovoBloqueio = typeof agendaBloqueios.$inferInsert;

/** Acesso à tabela agenda_bloqueios (dias ou horários em que não se marca reunião). */
export class BloqueioRepository {
  constructor(private readonly db: BancoDeDados) {}

  /** Primeiro bloqueio que pega o intervalo (dia inteiro ou horário que encosta). Horas em UTC, "HH:MM". */
  async primeiroNoIntervalo(data: string, horaIni: string, horaFim: string): Promise<Linha | undefined> {
    const { rows } = await this.db.execute(sql`
      SELECT motivo FROM agenda_bloqueios
      WHERE data = ${data}::date
        AND (
          dia_inteiro = TRUE
          OR (hora_inicio <= ${horaFim}::time AND hora_fim >= ${horaIni}::time)
        )
      LIMIT 1
    `);
    return rows[0];
  }

  async doDia(data: string): Promise<Linha[]> {
    const { rows } = await this.db.execute(sql`
      SELECT id, data, hora_inicio, hora_fim, dia_inteiro, motivo
      FROM agenda_bloqueios
      WHERE data = ${data}::date
      ORDER BY hora_inicio ASC NULLS FIRST
    `);
    return rows;
  }

  async doMes(mes: string): Promise<Linha[]> {
    const { rows } = await this.db.execute(sql`
      SELECT data, dia_inteiro, hora_inicio, hora_fim, motivo
      FROM agenda_bloqueios
      WHERE DATE_TRUNC('month', data) = DATE_TRUNC('month', ${mes + '-01'}::date)
      ORDER BY data ASC
    `);
    return rows;
  }

  /** Com nome de quem criou. Sem mês: da última semana em diante. */
  async listar(mes?: string): Promise<Linha[]> {
    const filtro = mes
      ? sql`WHERE DATE_TRUNC('month', data) = DATE_TRUNC('month', ${mes + '-01'}::date)`
      : sql`WHERE data >= CURRENT_DATE - INTERVAL '7 days'`;
    const { rows } = await this.db.execute(sql`
      SELECT ab.*, g.nome AS criado_por_nome
      FROM agenda_bloqueios ab
      LEFT JOIN gestores_trafego g ON g.id = ab.criado_por_id
      ${filtro}
      ORDER BY data ASC, hora_inicio ASC NULLS FIRST
    `);
    return rows;
  }

  async buscarPorId(id: number): Promise<AgendaBloqueio | undefined> {
    const [b] = await this.db.select().from(agendaBloqueios).where(eq(agendaBloqueios.id, id));
    return b;
  }

  async criar(dados: NovoBloqueio): Promise<AgendaBloqueio> {
    const [b] = await this.db.insert(agendaBloqueios).values(dados).returning();
    return b;
  }

  async remover(id: number): Promise<void> {
    await this.db.delete(agendaBloqueios).where(eq(agendaBloqueios.id, id));
  }
}
