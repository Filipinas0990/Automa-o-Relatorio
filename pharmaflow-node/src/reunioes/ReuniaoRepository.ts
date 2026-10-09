import { eq, sql } from 'drizzle-orm';
import { reunioes } from '../database/schema';
import type { Reuniao } from '../database/schema';
import type { BancoDeDados, Linha } from '../compartilhado/tipos';

export type NovaReuniao = typeof reunioes.$inferInsert;

export interface FiltrosReuniao {
  farmacia_id?: string;
  status?: string;
  mes?: string;
}

/** Reunião com os nomes da farmácia, do gestor e de quem criou. */
const COM_NOMES = sql`
  SELECT r.*,
         f.nome   AS farmacia_nome,
         g.nome   AS gestor_nome,
         cp.nome  AS criado_por_nome
  FROM reunioes r
  JOIN farmacias f       ON f.id  = r.farmacia_id
  LEFT JOIN gestores_trafego g  ON g.id  = r.gestor_id
  LEFT JOIN gestores_trafego cp ON cp.id = r.criado_por_id
`;

/** Acesso à tabela reunioes. */
export class ReuniaoRepository {
  constructor(private readonly db: BancoDeDados) {}

  async buscarPorId(id: number): Promise<Reuniao | undefined> {
    const [r] = await this.db.select().from(reunioes).where(eq(reunioes.id, id));
    return r;
  }

  async buscarComNomes(id: number): Promise<Linha | undefined> {
    const { rows } = await this.db.execute(sql`${COM_NOMES} WHERE r.id = ${id}`);
    return rows[0];
  }

  async listar(f: FiltrosReuniao): Promise<Linha[]> {
    const { rows } = await this.db.execute(sql`
      ${COM_NOMES}
      WHERE 1=1
      ${f.farmacia_id ? sql`AND r.farmacia_id = ${parseInt(f.farmacia_id)}` : sql``}
      ${f.status ? sql`AND r.status = ${f.status}` : sql``}
      ${f.mes ? sql`AND DATE_TRUNC('month', r.data_reuniao) = DATE_TRUNC('month', ${f.mes + '-01'}::date)` : sql``}
      ORDER BY r.data_reuniao DESC
    `);
    return rows;
  }

  async criar(dados: NovaReuniao): Promise<Reuniao> {
    const [r] = await this.db.insert(reunioes).values(dados).returning();
    return r;
  }

  async atualizar(id: number, dados: Partial<NovaReuniao>): Promise<void> {
    if (!Object.keys(dados).length) return;
    await this.db.update(reunioes).set(dados).where(eq(reunioes.id, id));
  }

  async gravarEventoGoogle(id: number, eventId: string): Promise<void> {
    await this.atualizar(id, { googleEventId: eventId });
  }

  /** Contadores do painel de reuniões. `gestorId` restringe às que ele conduz ou criou. */
  async estatisticas(gestorId: number | null, inicioMes: Date): Promise<Linha> {
    const filtro = gestorId ? sql`AND (r.gestor_id = ${gestorId} OR r.criado_por_id = ${gestorId})` : sql``;
    const { rows } = await this.db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE r.data_reuniao >= ${inicioMes.toISOString()}
                           AND r.status != 'cancelada')               AS reunioes_mes,
        COUNT(*) FILTER (WHERE r.status = 'realizada')                AS total_realizadas,
        COUNT(*) FILTER (WHERE r.data_reuniao >  NOW()
                           AND r.status IN ('agendada','confirmada')) AS agendadas_futuras,
        COUNT(*) FILTER (WHERE r.status = 'confirmada'
                           AND r.data_reuniao > NOW())                AS confirmadas_futuras
      FROM reunioes r ${filtro}
    `);
    return rows[0] || {};
  }

  /** Primeira reunião não cancelada que se sobrepõe a [inicio, fim). */
  async primeiraSobreposta(inicio: Date, fim: Date, ignorarId?: number): Promise<Linha | undefined> {
    const { rows } = await this.db.execute(sql`
      SELECT id, titulo, data_reuniao, duracao_minutos FROM reunioes
      WHERE status NOT IN ('cancelada')
      ${ignorarId ? sql`AND id != ${ignorarId}` : sql``}
        AND data_reuniao < ${fim.toISOString()}::timestamptz
        AND (data_reuniao + (duracao_minutos || ' minutes')::interval) > ${inicio.toISOString()}::timestamptz
      ORDER BY data_reuniao ASC
      LIMIT 1
    `);
    return rows[0];
  }

  /** Reuniões não canceladas do dia (`AAAA-MM-DD`), com o nome da farmácia. */
  async ativasDoDia(data: string): Promise<Linha[]> {
    const { rows } = await this.db.execute(sql`
      SELECT r.id, r.titulo, r.data_reuniao, r.duracao_minutos, r.status,
             f.nome AS farmacia_nome
      FROM reunioes r
      JOIN farmacias f ON f.id = r.farmacia_id
      WHERE r.data_reuniao::date = ${data}::date
        AND r.status NOT IN ('cancelada')
      ORDER BY r.data_reuniao ASC
    `);
    return rows;
  }

  /** Quantas reuniões (por status) em cada dia do mês. */
  async contagemPorDia(mes: string): Promise<Linha[]> {
    const { rows } = await this.db.execute(sql`
      SELECT data_reuniao::date AS dia, COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE status = 'realizada')::int  AS realizadas,
             COUNT(*) FILTER (WHERE status = 'confirmada')::int AS confirmadas,
             COUNT(*) FILTER (WHERE status = 'agendada')::int   AS agendadas
      FROM reunioes
      WHERE DATE_TRUNC('month', data_reuniao) = DATE_TRUNC('month', ${mes + '-01'}::date)
        AND status != 'cancelada'
      GROUP BY data_reuniao::date
    `);
    return rows;
  }
}
