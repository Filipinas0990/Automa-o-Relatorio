import type { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from 'fastify';
import { sql } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { db } from '../database/db';

type Middleware = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

interface RelatoriosRouteOptions extends FastifyPluginOptions {
  autenticar:  Middleware;
  apenasAdmin: Middleware;
}

// ── Consultas compartilhadas pelos exports (xlsx e csv) ───────────────────────

async function queryRelatorio(periodo: string) {
  const { rows } = await db.execute(sql`
    SELECT f.nome AS farmacia, g.nome AS gestor,
           c.periodo_inicio, c.periodo_fim, c.receita_total, c.total_atendimentos,
           c.vendas_realizadas, c.score_criticidade, c.nivel_alerta,
           f.meta_receita, f.meta_vendas,
           CASE
             WHEN f.meta_receita IS NOT NULL AND c.receita_total < f.meta_receita THEN 'Nao'
             WHEN f.meta_vendas  IS NOT NULL AND c.vendas_realizadas < f.meta_vendas THEN 'Nao'
             WHEN f.meta_receita IS NULL AND f.meta_vendas IS NULL THEN 'Sem meta'
             ELSE 'Sim'
           END AS atingiu_meta,
           CASE WHEN f.meta_receita > 0
                THEN ROUND(c.receita_total / f.meta_receita * 100, 1)
                ELSE NULL END AS pct_meta_receita
    FROM coletas c
    JOIN farmacias f ON f.id = c.farmacia_id
    LEFT JOIN gestores_trafego g ON g.id = f.gestor_id
    WHERE (c.data_coleta AT TIME ZONE 'UTC')::DATE::TEXT = ${periodo}
    ORDER BY c.score_criticidade DESC
  `);
  return rows;
}

async function queryCanaisRelatorio(periodo: string) {
  const { rows } = await db.execute(sql`
    SELECT f.nome AS farmacia, cc.canal, cc.atendimentos, cc.vendas, cc.receita_vendas
    FROM coleta_canais cc
    JOIN coletas c   ON c.id  = cc.coleta_id
    JOIN farmacias f ON f.id  = c.farmacia_id
    WHERE (c.data_coleta AT TIME ZONE 'UTC')::DATE::TEXT = ${periodo}
    ORDER BY f.nome, cc.atendimentos DESC
  `);
  return rows;
}

export async function relatoriosRoutes(
  app:  FastifyInstance,
  opts: RelatoriosRouteOptions,
): Promise<void> {
  const { autenticar } = opts;

  /** GET /api/relatorios — lista as rodadas de coleta (uma por dia). */
  app.get('/api/relatorios', { preHandler: autenticar }, async () => {
    const { rows } = await db.execute(sql`
      SELECT (data_coleta AT TIME ZONE 'UTC')::DATE::TEXT AS data_run,
             MIN(periodo_inicio)                           AS min_periodo_inicio,
             MAX(periodo_fim)                              AS max_periodo_fim,
             MAX(data_coleta)                              AS data_geracao,
             COUNT(DISTINCT farmacia_id)                   AS farmacias,
             SUM(CASE WHEN nivel_alerta != 'sem_dados' THEN 1 ELSE 0 END) AS concluidas
      FROM coletas
      GROUP BY (data_coleta AT TIME ZONE 'UTC')::DATE
      ORDER BY data_run DESC
      LIMIT 20
    `);
    const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    const fmtDate = (s: unknown) => {
      if (!s) return '';
      const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (!m) return '';
      return `${m[3]} ${meses[parseInt(m[2]) - 1]}`;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return rows.map((r: any, i: number) => {
      const total      = parseInt(r.farmacias || 0);
      const concluidas = parseInt(r.concluidas || total);
      return {
        id: i + 1,
        label: `Semana ${rows.length - i} — ${fmtDate(r.min_periodo_inicio)} a ${fmtDate(r.max_periodo_fim)}`,
        periodo_inicio: String(r.data_run),
        periodo_fim:    String(r.max_periodo_fim),
        data_geracao:   r.data_geracao,
        farmacias:      `${concluidas}/${total}`,
        status: concluidas === total ? 'Concluido' : concluidas > 0 ? 'Parcial' : 'Erro',
      };
    });
  });

  /** GET /api/relatorios/:periodo/xlsx — planilha com Resumo + Canais. */
  app.get('/api/relatorios/:periodo/xlsx', { preHandler: autenticar }, async (request, reply) => {
    const { periodo } = request.params as { periodo: string };
    const rows      = await queryRelatorio(periodo);
    const canalRows = await queryCanaisRelatorio(periodo);
    if (!rows.length) return reply.code(404).send({ detail: 'Período não encontrado' });

    const wb  = new ExcelJS.Workbook();
    const ws  = wb.addWorksheet('Resumo');
    const ws2 = wb.addWorksheet('Canais de Vendas');
    const headerFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF1A7A4A' } };
    const headerFont = { bold: true, color: { argb: 'FFFFFFFF' } };

    const cab1 = ['Farmácia','Gestor','Período Início','Período Fim','Receita (R$)','Meta Receita (R$)','% Meta Receita','Vendas','Meta Vendas','Atingiu Meta','Atendimentos','Score','Alerta'];
    ws.addRow(cab1);
    ws.getRow(1).eachCell(c => { c.fill = headerFill; c.font = headerFont; c.alignment = { horizontal: 'center' }; });
    cab1.forEach((t, i) => { ws.getColumn(i + 1).width = Math.max(t.length + 2, 16); });

    const cores: Record<string, string> = { verde: 'FFC6EFCE', amarelo: 'FFFFEB9C', vermelho: 'FFFFC7CE' };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of rows as any[]) {
      const pct = r.pct_meta_receita ? parseFloat(r.pct_meta_receita) / 100 : null;
      const row = ws.addRow([
        r.farmacia, r.gestor || '—', String(r.periodo_inicio), String(r.periodo_fim),
        parseFloat(r.receita_total || 0), r.meta_receita ? parseFloat(r.meta_receita) : '—',
        pct, parseInt(r.vendas_realizadas || 0), r.meta_vendas ? parseInt(r.meta_vendas) : '—',
        r.atingiu_meta, parseInt(r.total_atendimentos || 0), parseFloat(r.score_criticidade || 0), r.nivel_alerta,
      ]);
      const fill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: cores[r.nivel_alerta] || 'FFFFFFFF' } };
      row.eachCell(c => { c.fill = fill; });
      if (pct !== null) row.getCell(7).numFmt = '0.0%';
      row.getCell(5).numFmt = '#,##0.00';
      if (r.meta_receita) row.getCell(6).numFmt = '#,##0.00';
    }
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.autoFilter = { from: 'A1', to: { row: 1, column: cab1.length } };

    const cab2 = ['Farmácia','Canal','Atendimentos','Vendas','Receita (R$)'];
    ws2.addRow(cab2);
    ws2.getRow(1).eachCell(c => { c.fill = headerFill; c.font = headerFont; c.alignment = { horizontal: 'center' }; });
    cab2.forEach((t, i) => { ws2.getColumn(i + 1).width = Math.max(t.length + 4, 18); });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of canalRows as any[]) {
      const row = ws2.addRow([r.farmacia, r.canal, parseInt(r.atendimentos || 0), parseInt(r.vendas || 0), parseFloat(r.receita_vendas || 0)]);
      row.getCell(5).numFmt = '#,##0.00';
    }
    ws2.views = [{ state: 'frozen', ySplit: 1 }];

    const buffer = await wb.xlsx.writeBuffer();
    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename=relatorio_${periodo}.xlsx`)
      .send(Buffer.from(buffer as ArrayBuffer));
  });

  /** GET /api/relatorios/:periodo/csv — CSV com BOM (compatível com Power BI). */
  app.get('/api/relatorios/:periodo/csv', { preHandler: autenticar }, async (request, reply) => {
    const { periodo } = request.params as { periodo: string };
    const rows      = await queryRelatorio(periodo);
    const canalRows = await queryCanaisRelatorio(periodo);
    if (!rows.length) return reply.code(404).send({ detail: 'Período não encontrado' });

    const esc    = (v: unknown) => { const s = String(v ?? ''); return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csvRow = (arr: unknown[]) => arr.map(esc).join(',') + '\n';

    let csv = '﻿'; // BOM UTF-8 para Power BI
    csv += csvRow(['Farmacia','Gestor','Periodo_Inicio','Periodo_Fim','Receita_BRL','Meta_Receita_BRL','Pct_Meta_Receita','Vendas_Realizadas','Meta_Vendas','Atingiu_Meta','Total_Atendimentos','Score_Criticidade','Nivel_Alerta']);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of rows as any[]) {
      csv += csvRow([
        r.farmacia, r.gestor || '', String(r.periodo_inicio), String(r.periodo_fim),
        parseFloat(r.receita_total || 0), r.meta_receita ? parseFloat(r.meta_receita) : '',
        r.pct_meta_receita ? parseFloat(r.pct_meta_receita) : '',
        parseInt(r.vendas_realizadas || 0), r.meta_vendas ? parseInt(r.meta_vendas) : '',
        r.atingiu_meta, parseInt(r.total_atendimentos || 0),
        parseFloat(r.score_criticidade || 0), r.nivel_alerta,
      ]);
    }
    csv += '\n--- CANAIS DE VENDAS ---\n';
    csv += csvRow(['Farmacia','Canal','Atendimentos','Vendas','Receita_BRL']);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of canalRows as any[]) {
      csv += csvRow([r.farmacia, r.canal, parseInt(r.atendimentos || 0), parseInt(r.vendas || 0), parseFloat(r.receita_vendas || 0)]);
    }

    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename=relatorio_${periodo}.csv`)
      .send(Buffer.from(csv, 'utf-8'));
  });
}
