import 'dotenv/config';
import Fastify, { FastifyRequest, FastifyReply } from 'fastify';
import cors     from '@fastify/cors';
import formbody from '@fastify/formbody';
import bcrypt   from 'bcrypt';
import jwt      from 'jsonwebtoken';
import ExcelJS  from 'exceljs';
import { eq, and, sql } from 'drizzle-orm';
import { db } from '../database/db';
import { gestoresTrafego, farmacias } from '../database/schema';
import type { Gestor } from '../database/schema';
import { encrypt } from '../cripto';
import { pipeline } from '../pipeline-fn';
import { logger } from '../logger';

// ── Module augmentation — adiciona `user` ao FastifyRequest ───────────────────

declare module 'fastify' {
  interface FastifyRequest {
    user: Gestor;
  }
}

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    transport: {
      targets: [
        {
          target: 'pino-pretty',
          level: process.env.LOG_LEVEL || 'info',
          options: { colorize: true, translateTime: 'yyyy-mm-dd HH:MM:ss', ignore: 'pid,hostname' },
        },
        {
          target: 'pino/file',
          level: 'info',
          options: { destination: '/app/logs/pharmaflow.log', mkdir: true },
        },
      ],
    },
  },
});
app.register(cors,      { origin: '*' });
app.register(formbody);

// Aceita corpo vazio com Content-Type: application/json (ex: /api/rodar-agora)
app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
  if (!body || body === '') { done(null, {}); return; }
  try { done(null, JSON.parse(body as string)); }
  catch (e) { done(e as Error, undefined); }
});

const JWT_SECRET   = process.env.JWT_SECRET_KEY || 'troque-no-env-do-servidor';
const TOKEN_EXPIRE = '8h';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';

// ── JWT helpers ───────────────────────────────────────────────────────────────

function criarToken(gestorId: number, nome: string, isAdmin: boolean): string {
  return jwt.sign({ sub: String(gestorId), nome, is_admin: isAdmin }, JWT_SECRET, { expiresIn: TOKEN_EXPIRE });
}

async function autenticar(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const auth  = request.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) { reply.code(401).send({ detail: 'Token não fornecido' }); return; }
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { sub: string; nome: string; is_admin: boolean };
    const [gestor] = await db.select().from(gestoresTrafego).where(
      and(eq(gestoresTrafego.id, parseInt(payload.sub, 10)), eq(gestoresTrafego.ativo, true))
    );
    if (!gestor) { reply.code(401).send({ detail: 'Usuário não encontrado' }); return; }
    request.user = gestor;
  } catch {
    reply.code(401).send({ detail: 'Token inválido ou expirado' });
  }
}

async function apenasAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.user?.isAdmin) {
    reply.code(403).send({ detail: 'Acesso restrito ao administrador' });
  }
}

// ── Auth ──────────────────────────────────────────────────────────────────────

app.post('/api/auth/criar-super-admin', async (request, reply) => {
  const body = request.body as Record<string, string>;
  const { nome, email, senha, admin_secret } = body;
  if (!ADMIN_SECRET)                 return reply.code(503).send({ detail: 'ADMIN_SECRET não configurado' });
  if (admin_secret !== ADMIN_SECRET) return reply.code(403).send({ detail: 'Segredo inválido' });

  const admins = await db.select().from(gestoresTrafego).where(eq(gestoresTrafego.isAdmin, true));
  if (admins.length) return reply.code(409).send({ detail: 'Super admin já existe. Use o login normal.' });

  const existe = await db.select().from(gestoresTrafego).where(eq(gestoresTrafego.email, email));
  if (existe.length) return reply.code(409).send({ detail: 'Email já cadastrado' });

  const [admin] = await db.insert(gestoresTrafego).values({
    nome, email, senhaHash: await bcrypt.hash(senha, 10), isAdmin: true,
  }).returning();

  return reply.code(201).send({ id: admin.id, nome: admin.nome, email: admin.email, is_admin: true });
});

app.post('/api/auth/login', async (request, reply) => {
  const body     = request.body as Record<string, string>;
  const username = body.username || body.email;
  const password = body.password || body.senha;

  const [gestor] = await db.select().from(gestoresTrafego).where(eq(gestoresTrafego.email, username));
  if (!gestor || !await bcrypt.compare(password, gestor.senhaHash)) {
    return reply.code(401).send({ detail: 'Email ou senha incorretos' });
  }
  if (!gestor.ativo) return reply.code(403).send({ detail: 'Usuário inativo' });

  return {
    access_token: criarToken(gestor.id, gestor.nome, gestor.isAdmin),
    token_type:   'bearer',
    id:           gestor.id,
    nome:         gestor.nome,
    email:        gestor.email,
    is_admin:     gestor.isAdmin,
  };
});

app.get('/api/auth/me', { preHandler: autenticar }, async (request) => {
  const g = request.user;
  return { id: g.id, nome: g.nome, email: g.email, is_admin: g.isAdmin };
});

// ── Gestores CRUD ─────────────────────────────────────────────────────────────

app.get('/api/gestores', { preHandler: autenticar }, async () => {
  const rows = await db.execute(sql`
    SELECT g.*, COUNT(f.id) FILTER (WHERE f.ativa = TRUE) AS farmacias
    FROM gestores_trafego g
    LEFT JOIN farmacias f ON f.gestor_id = g.id
    WHERE g.ativo = TRUE
    GROUP BY g.id
    ORDER BY g.nome
  `);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rows.rows.map((g: any) => ({
    id: g.id, nome: g.nome, email: g.email,
    is_admin: g.is_admin, criado_em: g.criado_em,
    farmacias: parseInt(g.farmacias || 0),
  }));
});

app.post('/api/gestores', { preHandler: [autenticar, apenasAdmin] }, async (request, reply) => {
  const { nome, email, senha } = request.body as Record<string, string>;

  const existe = await db.select().from(gestoresTrafego).where(eq(gestoresTrafego.email, email));
  if (existe.length) return reply.code(409).send({ detail: 'Email já cadastrado' });

  const [g] = await db.insert(gestoresTrafego).values({
    nome, email, senhaHash: await bcrypt.hash(senha, 10), isAdmin: false,
  }).returning();

  return reply.code(201).send({ id: g.id, nome: g.nome, email: g.email });
});

app.put('/api/gestores/:id', { preHandler: [autenticar, apenasAdmin] }, async (request, reply) => {
  const id = parseInt((request.params as { id: string }).id, 10);
  const [existe] = await db.select().from(gestoresTrafego).where(eq(gestoresTrafego.id, id));
  if (!existe) return reply.code(404).send({ detail: 'Gestor não encontrado' });

  const { nome, email, senha } = request.body as Record<string, string>;
  const dados: Partial<typeof gestoresTrafego.$inferInsert> = {};
  if (nome)  dados.nome      = nome;
  if (email) dados.email     = email;
  if (senha) dados.senhaHash = await bcrypt.hash(senha, 10);

  if (Object.keys(dados).length) {
    await db.update(gestoresTrafego).set(dados).where(eq(gestoresTrafego.id, id));
  }
  const [g] = await db.select().from(gestoresTrafego).where(eq(gestoresTrafego.id, id));
  return { id: g.id, nome: g.nome, email: g.email };
});

app.delete('/api/gestores/:id', { preHandler: [autenticar, apenasAdmin] }, async (request, reply) => {
  const id = parseInt((request.params as { id: string }).id, 10);
  if (id === request.user.id) return reply.code(400).send({ detail: 'Não é possível deletar seu próprio usuário' });

  const [existe] = await db.select().from(gestoresTrafego).where(eq(gestoresTrafego.id, id));
  if (!existe) return reply.code(404).send({ detail: 'Gestor não encontrado' });

  await db.update(gestoresTrafego).set({ ativo: false }).where(eq(gestoresTrafego.id, id));
  return { mensagem: 'Gestor desativado' };
});

// ── Farmácias CRUD ────────────────────────────────────────────────────────────

app.post('/api/farmacias', { preHandler: [autenticar, apenasAdmin] }, async (request, reply) => {
  const body = request.body as Record<string, unknown>;
  const { nome, url_base, email, senha, gestor_id } = body as {
    nome: string; url_base: string; email: string; senha: string; gestor_id?: number;
  };
  const [f] = await db.insert(farmacias).values({
    nome, urlBase: url_base, email,
    senhaEnc: encrypt(senha),
    gestorId: gestor_id || null,
  }).returning();
  return reply.code(201).send({ id: f.id, nome: f.nome, gestor_id: f.gestorId });
});

app.put('/api/farmacias/:id', { preHandler: [autenticar, apenasAdmin] }, async (request, reply) => {
  const id = parseInt((request.params as { id: string }).id, 10);
  const [existe] = await db.select().from(farmacias).where(eq(farmacias.id, id));
  if (!existe) return reply.code(404).send({ detail: 'Farmácia não encontrada' });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = request.body as any;
  const dados: Partial<typeof farmacias.$inferInsert> = {};
  if (b.nome              !== undefined) dados.nome            = b.nome;
  if (b.url_base          !== undefined) dados.urlBase         = b.url_base;
  if (b.email             !== undefined) dados.email           = b.email;
  if (b.gestor_id         !== undefined) dados.gestorId        = b.gestor_id;
  if (b.ativa             !== undefined) dados.ativa           = b.ativa;
  if (b.meta_vendas       !== undefined) dados.metaVendas      = b.meta_vendas;
  if (b.meta_receita      !== undefined) dados.metaReceita     = b.meta_receita;
  if (b.meta_leads_google !== undefined) dados.metaLeadsGoogle = b.meta_leads_google;
  if (b.meta_leads_meta   !== undefined) dados.metaLeadsMeta   = b.meta_leads_meta;
  if (b.senha)                           dados.senhaEnc        = encrypt(b.senha);

  if (Object.keys(dados).length) {
    await db.update(farmacias).set(dados).where(eq(farmacias.id, id));
  }
  const [f] = await db.select().from(farmacias).where(eq(farmacias.id, id));
  return { id: f.id, nome: f.nome, ativa: f.ativa };
});

app.patch('/api/farmacias/:id/meta', { preHandler: [autenticar, apenasAdmin] }, async (request, reply) => {
  const id = parseInt((request.params as { id: string }).id, 10);
  const [existe] = await db.select().from(farmacias).where(eq(farmacias.id, id));
  if (!existe) return reply.code(404).send({ detail: 'Farmácia não encontrada' });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = request.body as any;
  const dados: Partial<typeof farmacias.$inferInsert> = {};
  if (b.meta_vendas        !== undefined) dados.metaVendas      = b.meta_vendas;
  if (b.meta_receita       !== undefined) dados.metaReceita     = b.meta_receita;
  if (b.meta_leads_google  !== undefined) dados.metaLeadsGoogle = b.meta_leads_google;
  if (b.meta_leads_meta    !== undefined) dados.metaLeadsMeta   = b.meta_leads_meta;

  if (Object.keys(dados).length) {
    await db.update(farmacias).set(dados).where(eq(farmacias.id, id));
  }
  const [f] = await db.select().from(farmacias).where(eq(farmacias.id, id));
  return {
    id: f.id, nome: f.nome,
    meta_vendas:       f.metaVendas,
    meta_receita:      f.metaReceita      ? parseFloat(f.metaReceita) : null,
    meta_leads_google: f.metaLeadsGoogle  ?? null,
    meta_leads_meta:   f.metaLeadsMeta    ?? null,
  };
});

app.delete('/api/farmacias/:id', { preHandler: [autenticar, apenasAdmin] }, async (request, reply) => {
  const id = parseInt((request.params as { id: string }).id, 10);
  const [existe] = await db.select().from(farmacias).where(eq(farmacias.id, id));
  if (!existe) return reply.code(404).send({ detail: 'Farmácia não encontrada' });

  await db.update(farmacias).set({ ativa: false }).where(eq(farmacias.id, id));
  return { mensagem: 'Farmácia desativada' };
});

// ── Helper de canal ───────────────────────────────────────────────────────────

function mapearNomeCanal(nome: string): string {
  const n = nome.toLowerCase();
  if (n.includes('google'))                                                     return 'Google';
  if (n.includes('facebook') || n.includes('instagram') || n.includes('meta')) return 'Meta';
  if (n.includes('grupo') || n.includes('oferta') || n.includes('group'))      return 'Grupos';
  return nome;
}

// ── Painel Geral ──────────────────────────────────────────────────────────────

app.get('/api/painel', { preHandler: autenticar }, async (request) => {
  const q = request.query as Record<string, string | undefined>;
  const filtroGid = request.user.isAdmin ? (q.gestor_id || null) : String(request.user.id);
  const filtroSql = filtroGid ? sql`AND f.gestor_id = ${filtroGid}` : sql``;

  const { rows } = await db.execute(sql`
    SELECT r.* FROM vw_ranking_atual r
    JOIN farmacias f ON f.id = r.farmacia_id
    WHERE TRUE ${filtroSql}
  `);

  if (!rows.length) {
    return {
      receita_total: 0, total_atendimentos: 0, vendas_realizadas: 0,
      farmacias_ativas: 0, farmacias_alerta: 0, farmacias_atencao: 0,
      taxa_conversao_media: 0, ultima_atualizacao: null, canais: [],
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const receitaTotal      = rows.reduce((s, r: any) => s + parseFloat(r.receita_total || 0), 0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const totalAtendimentos = rows.reduce((s, r: any) => s + parseInt(r.total_atendimentos || 0), 0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vendasRealizadas  = rows.reduce((s, r: any) => s + parseInt(r.vendas_realizadas || 0), 0);
  const conversoes = rows
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((r: any) => parseFloat(r.total_atendimentos || 0) > 0)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((r: any) => parseFloat(r.vendas_realizadas || 0) / parseFloat(r.total_atendimentos) * 100);
  const taxaMedia = conversoes.length
    ? Math.round(conversoes.reduce((a: number, b: number) => a + b, 0) / conversoes.length * 100) / 100 : 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ultimaAtualizacao = rows.reduce((max: any, r: any) => !max || r.data_coleta > max ? r.data_coleta : max, null);

  const { rows: canaisRows } = await db.execute(sql`
    SELECT cc.canal,
           SUM(cc.atendimentos)::int       AS total_atendimentos,
           SUM(cc.vendas)::int             AS total_vendas,
           SUM(cc.receita_vendas)::numeric AS total_receita_vendas
    FROM coleta_canais cc
    JOIN (SELECT DISTINCT ON (farmacia_id) id AS coleta_id, farmacia_id
          FROM coletas ORDER BY farmacia_id, data_coleta DESC) latest
      ON latest.coleta_id = cc.coleta_id
    JOIN farmacias f ON f.id = latest.farmacia_id
    WHERE f.ativa = TRUE ${filtroSql}
    GROUP BY cc.canal
    ORDER BY total_atendimentos DESC
  `);

  const canaisAgg: Record<string, { atendimentos: number; vendas: number; receita_vendas: number }> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of canaisRows as any[]) {
    const nome = mapearNomeCanal(row.canal);
    if (!canaisAgg[nome]) canaisAgg[nome] = { atendimentos: 0, vendas: 0, receita_vendas: 0 };
    canaisAgg[nome].atendimentos   += parseInt(row.total_atendimentos || 0);
    canaisAgg[nome].vendas         += parseInt(row.total_vendas || 0);
    canaisAgg[nome].receita_vendas += parseFloat(row.total_receita_vendas || 0);
  }

  return {
    receita_total:        Math.round(receitaTotal * 100) / 100,
    total_atendimentos:   totalAtendimentos,
    vendas_realizadas:    vendasRealizadas,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    farmacias_ativas:     rows.length,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    farmacias_alerta:     rows.filter((r: any) => r.nivel_alerta === 'vermelho').length,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    farmacias_atencao:    rows.filter((r: any) => r.nivel_alerta === 'amarelo').length,
    taxa_conversao_media: taxaMedia,
    ultima_atualizacao:   ultimaAtualizacao,
    canais: Object.entries(canaisAgg)
      .sort((a, b) => b[1].atendimentos - a[1].atendimentos)
      .map(([nome, d]) => ({
        nome,
        atendimentos:   d.atendimentos,
        vendas:         d.vendas,
        receita_vendas: Math.round(d.receita_vendas * 100) / 100,
      })),
  };
});

// ── Farmácias listagem + evolução ─────────────────────────────────────────────

app.get('/api/farmacias', { preHandler: autenticar }, async (request) => {
  const q         = request.query as Record<string, string | undefined>;
  const { status, busca, gestor_id } = q;
  const filtro    = request.user.isAdmin ? (gestor_id || null) : String(request.user.id);
  const filtroSql = filtro ? sql`AND f.gestor_id = ${filtro}` : sql``;

  const { rows } = await db.execute(sql`
    SELECT f.id AS farmacia_id, f.nome AS farmacia, f.gestor_id, f.ativa,
           f.meta_vendas, f.meta_receita, f.meta_leads_google, f.meta_leads_meta,
           COALESCE(r.nivel_alerta, 'verde')    AS nivel_alerta,
           COALESCE(r.receita_total, 0)         AS receita_total,
           COALESCE(r.total_atendimentos, 0)    AS total_atendimentos,
           COALESCE(r.vendas_realizadas, 0)     AS vendas_realizadas,
           COALESCE(r.variacao_receita, 0)      AS variacao_receita,
           COALESCE(r.variacao_vendas, 0)       AS variacao_vendas,
           COALESCE(r.score_criticidade, 0)     AS score_criticidade,
           COALESCE(r.posicao_ranking, 9999)    AS posicao_ranking,
           r.periodo_inicio, r.periodo_fim, r.data_coleta
    FROM farmacias f
    LEFT JOIN vw_ranking_atual r ON r.farmacia_id = f.id
    WHERE f.ativa = TRUE ${filtroSql}
    ORDER BY posicao_ranking
  `);

  const { rows: canaisRows } = await db.execute(sql`
    SELECT latest.farmacia_id, cc.canal,
           SUM(cc.atendimentos)::int       AS total_atendimentos,
           SUM(cc.vendas)::int             AS total_vendas,
           SUM(cc.receita_vendas)::numeric AS total_receita_vendas
    FROM coleta_canais cc
    JOIN (SELECT DISTINCT ON (farmacia_id) id AS coleta_id, farmacia_id
          FROM coletas ORDER BY farmacia_id, data_coleta DESC) latest
      ON latest.coleta_id = cc.coleta_id
    JOIN farmacias f ON f.id = latest.farmacia_id
    WHERE f.ativa = TRUE ${filtroSql}
    GROUP BY latest.farmacia_id, cc.canal
    ORDER BY latest.farmacia_id, total_atendimentos DESC
  `);

  const canaisPorFarmacia: Record<number, Record<string, { atendimentos: number; vendas: number; receita_vendas: number }>> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const cr of canaisRows as any[]) {
    const fid = parseInt(cr.farmacia_id);
    const nomeStd = mapearNomeCanal(cr.canal);
    if (!canaisPorFarmacia[fid]) canaisPorFarmacia[fid] = {};
    if (!canaisPorFarmacia[fid][nomeStd]) canaisPorFarmacia[fid][nomeStd] = { atendimentos: 0, vendas: 0, receita_vendas: 0 };
    canaisPorFarmacia[fid][nomeStd].atendimentos   += parseInt(cr.total_atendimentos || 0);
    canaisPorFarmacia[fid][nomeStd].vendas         += parseInt(cr.total_vendas || 0);
    canaisPorFarmacia[fid][nomeStd].receita_vendas += parseFloat(cr.total_receita_vendas || 0);
  }

  const resultado = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of rows as any[]) {
    const labelStatus = ({ verde: 'Ativa', amarelo: 'Atencao', vermelho: 'Alerta' } as Record<string, string>)[r.nivel_alerta] || 'Ativa';
    if (status && labelStatus.toLowerCase() !== status.toLowerCase()) continue;
    if (busca  && !r.farmacia.toLowerCase().includes(busca.toLowerCase())) continue;

    const fid          = parseInt(r.farmacia_id);
    const receitaAtual = parseFloat(r.receita_total || 0);
    const vendasAtual  = parseInt(r.vendas_realizadas || 0);
    const metaV        = r.meta_vendas  ? parseInt(r.meta_vendas)    : null;
    const metaR        = r.meta_receita ? parseFloat(r.meta_receita) : null;

    let atingiuMeta: boolean | null = null, pctMetaReceita = 0, pctMetaVendas = 0;
    if (metaR) { pctMetaReceita = Math.round(receitaAtual / metaR * 1000) / 10; atingiuMeta = receitaAtual >= metaR; }
    if (metaV) {
      pctMetaVendas = Math.round(vendasAtual / metaV * 1000) / 10;
      atingiuMeta   = atingiuMeta === null ? vendasAtual >= metaV : atingiuMeta && (vendasAtual >= metaV);
    }

    resultado.push({
      id: fid, nome: r.farmacia, status: labelStatus, nivel_alerta: r.nivel_alerta,
      gestor_id: r.gestor_id, receita_total: receitaAtual,
      total_atendimentos: parseInt(r.total_atendimentos || 0),
      atendimentos_finalizados: 0,
      vendas_realizadas: vendasAtual, taxa_conversao: 0,
      variacao_receita:      parseFloat(r.variacao_receita || 0),
      variacao_atendimentos: 0,
      variacao_vendas:       parseFloat(r.variacao_vendas || 0),
      score_criticidade:     parseFloat(r.score_criticidade || 0),
      posicao_ranking:       parseInt(r.posicao_ranking),
      periodo_inicio: r.periodo_inicio ? String(r.periodo_inicio) : null,
      periodo_fim:    r.periodo_fim    ? String(r.periodo_fim)    : null,
      data_coleta: r.data_coleta,
      meta_vendas: metaV, meta_receita: metaR,
      meta_leads_google: r.meta_leads_google ? parseInt(r.meta_leads_google) : null,
      meta_leads_meta:   r.meta_leads_meta   ? parseInt(r.meta_leads_meta)   : null,
      atingiu_meta: atingiuMeta,
      percentual_meta_receita: pctMetaReceita,
      percentual_meta_vendas:  pctMetaVendas,
      canais: Object.entries(canaisPorFarmacia[fid] || {})
        .sort((a, b) => b[1].atendimentos - a[1].atendimentos)
        .map(([nome, d]) => ({
          nome, atendimentos: d.atendimentos, vendas: d.vendas,
          receita_vendas: Math.round(d.receita_vendas * 100) / 100,
        })),
    });
  }
  return resultado;
});

app.get('/api/farmacias/:id/evolucao', { preHandler: autenticar }, async (request, reply) => {
  const id = parseInt((request.params as { id: string }).id, 10);
  if (!request.user.isAdmin) {
    const [f] = await db.select().from(farmacias).where(
      and(eq(farmacias.id, id), eq(farmacias.gestorId, request.user.id))
    );
    if (!f) return reply.code(403).send({ detail: 'Acesso negado a esta farmácia' });
  }
  const { rows } = await db.execute(sql`
    SELECT * FROM vw_evolucao_semanal WHERE farmacia_id = ${id} ORDER BY semana_numero ASC
  `);
  return rows;
});

// ── Relatórios ────────────────────────────────────────────────────────────────

app.get('/api/relatorios', { preHandler: autenticar }, async () => {
  const { rows } = await db.execute(sql`
    SELECT DATE_TRUNC('week', data_coleta)::DATE AS periodo_inicio,
           MAX(periodo_fim)                      AS periodo_fim,
           MAX(data_coleta)                      AS data_geracao,
           COUNT(DISTINCT farmacia_id)           AS farmacias,
           SUM(CASE WHEN nivel_alerta != 'sem_dados' THEN 1 ELSE 0 END) AS concluidas
    FROM coletas
    GROUP BY DATE_TRUNC('week', data_coleta)::DATE
    ORDER BY periodo_inicio DESC
    LIMIT 20
  `);
  const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const fmt   = (d: unknown) => {
    if (!d) return '';
    const dt = new Date(String(d));
    return `${String(dt.getDate()).padStart(2,'0')} ${meses[dt.getMonth()]}`;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rows.map((r: any, i: number) => {
    const total      = parseInt(r.farmacias || 0);
    const concluidas = parseInt(r.concluidas || total);
    return {
      id: i + 1,
      label: `Semana ${rows.length - i} — ${fmt(r.periodo_inicio)} a ${fmt(r.periodo_fim)}`,
      periodo_inicio: String(r.periodo_inicio),
      periodo_fim:    String(r.periodo_fim),
      data_geracao:   r.data_geracao,
      farmacias:      `${concluidas}/${total}`,
      status: concluidas === total ? 'Concluido' : concluidas > 0 ? 'Parcial' : 'Erro',
    };
  });
});

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
    WHERE c.periodo_inicio::TEXT = ${periodo}
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
    WHERE c.periodo_inicio::TEXT = ${periodo}
    ORDER BY f.nome, cc.atendimentos DESC
  `);
  return rows;
}

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

// ── Pipeline manual ───────────────────────────────────────────────────────────

let pipelineRodando = false;

app.post('/api/rodar-agora', { preHandler: [autenticar, apenasAdmin] }, async (_request, reply) => {
  if (pipelineRodando) return { status: 'ja_rodando', mensagem: 'Pipeline já está em execução' };
  pipelineRodando = true;
  reply.send({ status: 'iniciado', mensagem: 'Pipeline iniciado em background' });
  setImmediate(async () => {
    try { await pipeline(); }
    catch (e) { logger.error({ err: e }, 'Erro no pipeline manual'); }
    finally { pipelineRodando = false; }
  });
});

app.get('/api/status', { logLevel: 'silent' }, async () => ({
  pipeline_rodando: pipelineRodando,
  timestamp: new Date().toISOString(),
}));

// ── Ranking de Gestores ───────────────────────────────────────────────────────

app.get('/api/ranking/gestores', { preHandler: autenticar }, async (request, reply) => {
  const q = request.query as Record<string, string | undefined>;
  let mesRef: string;
  if (q.mes) {
    if (!/^\d{4}-\d{2}$/.test(q.mes)) return reply.code(400).send({ detail: 'Formato inválido. Use YYYY-MM.' });
    mesRef = q.mes + '-01';
  } else {
    const now = new Date();
    mesRef = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  }

  const { rows } = await db.execute(sql`
    SELECT g.id AS gestor_id, g.nome AS gestor_nome,
           (COUNT(*) FILTER (WHERE c.atingiu_meta = TRUE) +
            COUNT(*) FILTER (WHERE c.atingiu_meta_google = TRUE) +
            COUNT(*) FILTER (WHERE c.atingiu_meta_meta = TRUE)) AS pontos,
           COUNT(*)                                              AS coletas_no_mes,
           COUNT(DISTINCT c.farmacia_id)                        AS farmacias_com_coleta,
           (SELECT COUNT(*) FROM farmacias f2 WHERE f2.gestor_id = g.id AND f2.ativa = TRUE) AS total_farmacias
    FROM gestores_trafego g
    JOIN farmacias f ON f.gestor_id = g.id AND f.ativa = TRUE
    JOIN coletas c   ON c.farmacia_id = f.id
                    AND DATE_TRUNC('month', c.data_coleta) = DATE_TRUNC('month', CAST(${mesRef} AS date))
    WHERE g.ativo = TRUE
    GROUP BY g.id, g.nome
    ORDER BY pontos DESC, g.nome
  `);

  const todosGestores = await db.select().from(gestoresTrafego).where(eq(gestoresTrafego.ativo, true));
  const { rows: farRows } = await db.execute(sql`
    SELECT gestor_id, COUNT(*)::int AS total FROM farmacias WHERE ativa = TRUE GROUP BY gestor_id
  `);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const farPorGestor = Object.fromEntries((farRows as any[]).map(f => [f.gestor_id, f.total]));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ranking = (rows as any[]).map((r, i) => {
    const coletasNM = parseInt(r.coletas_no_mes || 0);
    const pontos    = parseInt(r.pontos || 0);
    return {
      posicao: i + 1, gestor_id: r.gestor_id, gestor_nome: r.gestor_nome,
      pontos, total_farmacias: parseInt(r.total_farmacias || 0),
      farmacias_com_coleta: parseInt(r.farmacias_com_coleta || 0),
      coletas_no_mes: coletasNM,
      taxa_acerto: coletasNM > 0 ? Math.round(pontos / coletasNM * 1000) / 10 : 0,
      mes: mesRef.slice(0, 7),
    };
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const comColeta = new Set((rows as any[]).map(r => r.gestor_id));
  let pos = ranking.length + 1;
  for (const g of todosGestores) {
    if (comColeta.has(g.id)) continue;
    const total = farPorGestor[g.id] || 0;
    if (!total) continue;
    ranking.push({
      posicao: pos++, gestor_id: g.id, gestor_nome: g.nome,
      pontos: 0, total_farmacias: total, farmacias_com_coleta: 0,
      coletas_no_mes: 0, taxa_acerto: 0, mes: mesRef.slice(0, 7),
    });
  }
  return ranking;
});

app.get('/api/ranking/gestores/historico', { preHandler: autenticar }, async () => {
  const { rows } = await db.execute(sql`
    SELECT g.id AS gestor_id, g.nome AS gestor_nome,
           TO_CHAR(DATE_TRUNC('month', c.data_coleta), 'YYYY-MM') AS mes,
           (COUNT(*) FILTER (WHERE c.atingiu_meta = TRUE) +
            COUNT(*) FILTER (WHERE c.atingiu_meta_google = TRUE) +
            COUNT(*) FILTER (WHERE c.atingiu_meta_meta = TRUE)) AS pontos,
           COUNT(*) AS coletas_no_mes
    FROM gestores_trafego g
    JOIN farmacias f ON f.gestor_id = g.id AND f.ativa = TRUE
    JOIN coletas c   ON c.farmacia_id = f.id
                    AND c.data_coleta >= NOW() - INTERVAL '6 months'
    WHERE g.ativo = TRUE
    GROUP BY g.id, g.nome, DATE_TRUNC('month', c.data_coleta)
    ORDER BY mes DESC, pontos DESC
  `);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (rows as any[]).map(r => ({
    gestor_id: r.gestor_id, gestor_nome: r.gestor_nome, mes: r.mes,
    pontos: parseInt(r.pontos || 0), coletas_no_mes: parseInt(r.coletas_no_mes || 0),
  }));
});

// ── Tratamento global de erros ────────────────────────────────────────────────

app.setErrorHandler((error, _request, reply) => {
  logger.error({ err: error }, 'Erro interno não tratado');
  reply.code(500).send({ detail: 'Erro interno do servidor' });
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || '8000', 10);
app.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) { console.error(err); process.exit(1); }
  console.log(`PharmaFlow API rodando em http://0.0.0.0:${PORT}`);
});

export default app;
