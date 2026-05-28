import 'dotenv/config';
import Fastify, { FastifyRequest, FastifyReply } from 'fastify';
import cors     from '@fastify/cors';
import formbody from '@fastify/formbody';
import bcrypt   from 'bcrypt';
import jwt      from 'jsonwebtoken';
import ExcelJS  from 'exceljs';
import { eq, and, sql } from 'drizzle-orm';
import { google } from 'googleapis';
import { db } from '../database/db';
import { gestoresTrafego, farmacias, reunioes, agendaBloqueios } from '../database/schema';
import type { Gestor } from '../database/schema';
import { encrypt } from '../cripto';
import { pipeline, previewPipeline } from '../pipeline-fn';
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
  const { nome, url_base, email, senha, gestor_id, tem_chatbot } = body as {
    nome: string; url_base?: string; email?: string; senha?: string;
    gestor_id?: number; tem_chatbot?: boolean;
  };

  if (!nome) return reply.code(400).send({ detail: 'Campo "nome" é obrigatório.' });

  const temChatbotBool = tem_chatbot !== false; // default true

  // Campos de chatbot só são obrigatórios quando tem_chatbot = true
  if (temChatbotBool && (!url_base || !email || !senha)) {
    return reply.code(400).send({
      detail: 'Para farmácias com chatbot, os campos url_base, email e senha são obrigatórios.',
    });
  }

  const [f] = await db.insert(farmacias).values({
    nome,
    urlBase:    temChatbotBool ? url_base! : null,
    email:      temChatbotBool ? email!    : null,
    senhaEnc:   temChatbotBool && senha ? encrypt(senha) : null,
    gestorId:   gestor_id || null,
    temChatbot: temChatbotBool,
  }).returning();

  return reply.code(201).send({
    id:          f.id,
    nome:        f.nome,
    gestor_id:   f.gestorId,
    tem_chatbot: f.temChatbot,
  });
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
  if (b.tem_chatbot       !== undefined) dados.temChatbot      = b.tem_chatbot;
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
  const dias      = parseInt(q.dias || '7', 10);

  const { rows } = await db.execute(sql`
    SELECT r.* FROM vw_ranking_atual r
    JOIN farmacias f ON f.id = r.farmacia_id
    WHERE r.periodo_dias = ${dias} ${filtroSql}
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
          FROM coletas WHERE periodo_dias = ${dias} ORDER BY farmacia_id, data_coleta DESC) latest
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
  const dias      = parseInt(q.dias || '7', 10);

  const { rows } = await db.execute(sql`
    SELECT f.id AS farmacia_id, f.nome AS farmacia, f.gestor_id, f.ativa, f.tem_chatbot,
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
    LEFT JOIN vw_ranking_atual r ON r.farmacia_id = f.id AND r.periodo_dias = ${dias}
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
          FROM coletas WHERE periodo_dias = ${dias} ORDER BY farmacia_id, data_coleta DESC) latest
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
      tem_chatbot: r.tem_chatbot !== false,
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
  const id   = parseInt((request.params as { id: string }).id, 10);
  const dias = parseInt((request.query as Record<string, string>).dias || '7', 10);
  if (!request.user.isAdmin) {
    const [f] = await db.select().from(farmacias).where(
      and(eq(farmacias.id, id), eq(farmacias.gestorId, request.user.id))
    );
    if (!f) return reply.code(403).send({ detail: 'Acesso negado a esta farmácia' });
  }
  const { rows } = await db.execute(sql`
    SELECT * FROM vw_evolucao_semanal
    WHERE farmacia_id = ${id} AND periodo_dias = ${dias}
    ORDER BY semana_numero ASC
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

// Preview: mostra quantas farmácias e quais períodos seriam coletados
app.get('/api/rodar-agora/preview', { preHandler: [autenticar, apenasAdmin] }, async (request) => {
  const q        = request.query as Record<string, string | undefined>;
  const gestorId = q.gestor_id ? parseInt(q.gestor_id) : undefined;
  const periodos = q.periodos
    ? q.periodos.split(',').map(Number).filter(n => [7, 15, 30].includes(n))
    : [7, 15, 30];
  return previewPipeline({ periodos, gestorId });
});

app.post('/api/rodar-agora', { preHandler: [autenticar, apenasAdmin] }, async (request, reply) => {
  if (pipelineRodando) return reply.code(409).send({ status: 'ja_rodando', mensagem: 'Pipeline já está em execução' });

  const body     = (request.body as Record<string, unknown>) || {};
  const periodos = Array.isArray(body.periodos) && body.periodos.length
    ? (body.periodos as number[]).filter(n => [7, 15, 30].includes(n))
    : [7, 15, 30];
  const gestorId = body.gestor_id ? parseInt(String(body.gestor_id)) : undefined;

  pipelineRodando = true;
  reply.send({ status: 'iniciado', mensagem: 'Pipeline iniciado em background', periodos, gestor_id: gestorId ?? null });
  setImmediate(async () => {
    try { await pipeline({ periodos, gestorId }); }
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

// ── Google Calendar — helpers ─────────────────────────────────────────────────

const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID     || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URI  = process.env.GOOGLE_REDIRECT_URI  ||
  'https://api.pharmarelatorios.online/api/auth/google/callback';
const GOOGLE_SCOPES        = ['https://www.googleapis.com/auth/calendar.events'];

function makeOAuth2() {
  return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
}

/** Gera URL "Adicionar ao Google Calendar" sem precisar de OAuth (abre no navegador) */
function googleCalendarLink(r: {
  titulo: string;
  descricao?: string | null;
  dataReuniao: Date | string;
  duracaoMinutos?: number | null;
  local?: string | null;
  linkMeet?: string | null;
}): string {
  const inicio = new Date(r.dataReuniao);
  const fim    = new Date(inicio.getTime() + (r.duracaoMinutos ?? 60) * 60_000);
  const fmt    = (d: Date) => d.toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';
  const detalhes = [r.descricao, r.linkMeet ? `\nLink da reunião: ${r.linkMeet}` : '']
    .filter(Boolean).join('');
  const p = new URLSearchParams({
    action:   'TEMPLATE',
    text:     r.titulo,
    dates:    `${fmt(inicio)}/${fmt(fim)}`,
    details:  detalhes,
    location: r.local ?? '',
  });
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

/** Cria (ou atualiza) um evento no Google Calendar do usuário via API */
async function syncGoogleEvent(gestorId: number, reuniaoId: number): Promise<string | null> {
  if (!GOOGLE_CLIENT_ID) return null;

  const [gestor] = await db.select().from(gestoresTrafego)
    .where(eq(gestoresTrafego.id, gestorId));
  if (!gestor?.googleRefreshToken) return null;

  const [reuniao] = await db.select().from(reunioes).where(eq(reunioes.id, reuniaoId));
  if (!reuniao) return null;

  const auth = makeOAuth2();
  auth.setCredentials({ refresh_token: gestor.googleRefreshToken });
  const cal = google.calendar({ version: 'v3', auth });

  const inicio = new Date(reuniao.dataReuniao);
  const fim    = new Date(inicio.getTime() + (reuniao.duracaoMinutos ?? 60) * 60_000);
  const calendarId = gestor.googleCalendarId ?? 'primary';

  const eventBody = {
    summary:     reuniao.titulo,
    description: [reuniao.descricao, reuniao.linkMeet ? `Link: ${reuniao.linkMeet}` : '']
      .filter(Boolean).join('\n'),
    location:    reuniao.local ?? undefined,
    start: { dateTime: inicio.toISOString() },
    end:   { dateTime: fim.toISOString()    },
    conferenceData: reuniao.linkMeet ? undefined : undefined, // Meet link opcional
  };

  let eventId = reuniao.googleEventId;
  if (eventId) {
    // Atualiza evento existente
    try {
      await cal.events.update({ calendarId, eventId, requestBody: eventBody });
    } catch {
      // Se não encontrar, cria novo
      const res = await cal.events.insert({ calendarId, requestBody: eventBody });
      eventId = res.data.id ?? null;
    }
  } else {
    const res = await cal.events.insert({ calendarId, requestBody: eventBody });
    eventId = res.data.id ?? null;
  }

  if (eventId) {
    await db.update(reunioes)
      .set({ googleEventId: eventId })
      .where(eq(reunioes.id, reuniaoId));
  }
  return eventId;
}

/** Remove evento do Google Calendar */
async function deleteGoogleEvent(gestorId: number, reuniaoId: number): Promise<void> {
  if (!GOOGLE_CLIENT_ID) return;
  const [gestor] = await db.select().from(gestoresTrafego).where(eq(gestoresTrafego.id, gestorId));
  if (!gestor?.googleRefreshToken) return;
  const [reuniao] = await db.select().from(reunioes).where(eq(reunioes.id, reuniaoId));
  if (!reuniao?.googleEventId) return;

  const auth = makeOAuth2();
  auth.setCredentials({ refresh_token: gestor.googleRefreshToken });
  const cal = google.calendar({ version: 'v3', auth });
  try {
    await cal.events.delete({
      calendarId: gestor.googleCalendarId ?? 'primary',
      eventId: reuniao.googleEventId,
    });
  } catch { /* ignora se já foi deletado */ }
}

// ── Google OAuth — connect / callback / status / disconnect ──────────────────

/** Inicia o fluxo OAuth2 — dois modos:
 *  1. GET /api/auth/google/url  (fetch com Bearer header) → retorna { url }
 *  2. GET /api/auth/google?token=JWT  (window.location.href) → redireciona direto
 */

// Modo 1 — retorna a URL como JSON (frontend faz window.location.href = url)
app.get('/api/auth/google/url', { preHandler: autenticar }, async (request, reply) => {
  if (!GOOGLE_CLIENT_ID) {
    return reply.code(503).send({ detail: 'Google Calendar não configurado no servidor.' });
  }
  const state = Buffer.from(String(request.user.id)).toString('base64url');
  const url   = makeOAuth2().generateAuthUrl({
    access_type: 'offline',
    prompt:      'consent',
    scope:       GOOGLE_SCOPES,
    state,
  });
  return { url };
});

// Modo 2 — redirect direto (usado via window.location.href com ?token=)
app.get('/api/auth/google', async (request, reply) => {
  if (!GOOGLE_CLIENT_ID) {
    return reply.code(503).send({ detail: 'Google Calendar não configurado no servidor.' });
  }

  // Aceita token via query param (necessário para window.location.href)
  const q     = request.query as Record<string, string>;
  const token = q.token || (request.headers.authorization?.replace('Bearer ', '') ?? '');

  if (!token) return reply.code(401).send({ detail: 'Token não fornecido.' });

  let gestorId: number;
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { sub: string };
    gestorId = parseInt(payload.sub, 10);
    if (!gestorId) throw new Error('id inválido');
  } catch {
    return reply.code(401).send({ detail: 'Token inválido.' });
  }

  const state = Buffer.from(String(gestorId)).toString('base64url');
  const url   = makeOAuth2().generateAuthUrl({
    access_type: 'offline',
    prompt:      'consent',
    scope:       GOOGLE_SCOPES,
    state,
  });
  return reply.redirect(url);
});

/** Callback do Google após autorização */
app.get('/api/auth/google/callback', async (request, reply) => {
  if (!GOOGLE_CLIENT_ID) return reply.code(503).send({ detail: 'Google não configurado.' });

  const q     = request.query as Record<string, string>;
  const code  = q.code;
  const state = q.state;
  const error = q.error;

  const frontendUrl = process.env.FRONTEND_URL || 'https://pharmarelatorios.online';

  if (error || !code || !state) {
    return reply.redirect(`${frontendUrl}/reunioes?google=error`);
  }

  let gestorId: number;
  try {
    gestorId = parseInt(Buffer.from(state, 'base64url').toString(), 10);
    if (!gestorId || isNaN(gestorId)) throw new Error('state inválido');
  } catch {
    return reply.redirect(`${frontendUrl}/reunioes?google=error`);
  }

  try {
    const auth = makeOAuth2();
    const { tokens } = await auth.getToken(code);
    const refreshToken = tokens.refresh_token;

    if (!refreshToken) {
      // Usuário já autorizou antes — refresh_token não é reenviado pelo Google
      return reply.redirect(`${frontendUrl}/reunioes?google=already_connected`);
    }

    await db.update(gestoresTrafego)
      .set({ googleRefreshToken: refreshToken })
      .where(eq(gestoresTrafego.id, gestorId));

    return reply.redirect(`${frontendUrl}/reunioes?google=connected`);
  } catch (e) {
    logger.error({ err: e }, 'Erro no callback Google OAuth');
    return reply.redirect(`${frontendUrl}/reunioes?google=error`);
  }
});

/** Status da conexão Google do gestor logado */
app.get('/api/auth/google/status', { preHandler: autenticar }, async (request) => {
  const [g] = await db.select({ googleRefreshToken: gestoresTrafego.googleRefreshToken })
    .from(gestoresTrafego).where(eq(gestoresTrafego.id, request.user.id));
  return { conectado: !!g?.googleRefreshToken, google_configurado: !!GOOGLE_CLIENT_ID };
});

/** Desconecta Google Calendar do gestor */
app.delete('/api/auth/google', { preHandler: autenticar }, async (request) => {
  await db.update(gestoresTrafego)
    .set({ googleRefreshToken: null })
    .where(eq(gestoresTrafego.id, request.user.id));
  return { mensagem: 'Google Calendar desconectado.' };
});

// ── Agenda — Verificação de Conflito ─────────────────────────────────────────

interface ResultadoConflito {
  conflito: boolean;
  tipo?: 'bloqueio' | 'sobreposicao';
  detalhe?: string;
  reuniao_conflitante?: { id: number; titulo: string; data_reuniao: string; duracao_minutos: number };
}

/**
 * Verifica se um horário está disponível.
 * Checa: (1) bloqueios de agenda e (2) sobreposição com reuniões existentes.
 */
async function verificarConflito(
  dataReuniao: Date,
  duracaoMinutos: number,
  ignorarReuniaoId?: number,
): Promise<ResultadoConflito> {
  const inicio   = dataReuniao;
  const fim      = new Date(inicio.getTime() + duracaoMinutos * 60_000);
  const dataStr  = inicio.toISOString().split('T')[0];          // "YYYY-MM-DD"
  const horaIni  = inicio.toISOString().split('T')[1].slice(0, 5); // "HH:MM" UTC
  const horaFim  = fim.toISOString().split('T')[1].slice(0, 5);

  // 1. Verifica bloqueios de agenda
  const { rows: bloqs } = await db.execute(sql`
    SELECT motivo FROM agenda_bloqueios
    WHERE data = ${dataStr}::date
      AND (
        dia_inteiro = TRUE
        OR (hora_inicio <= ${horaFim}::time AND hora_fim >= ${horaIni}::time)
      )
    LIMIT 1
  `);
  if (bloqs.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = bloqs[0] as any;
    return {
      conflito: true,
      tipo: 'bloqueio',
      detalhe: b.motivo ? `Agenda fechada: ${b.motivo}` : 'Agenda fechada neste horário.',
    };
  }

  // 2. Verifica sobreposição com reuniões existentes
  const ignorar = ignorarReuniaoId ? sql`AND id != ${ignorarReuniaoId}` : sql``;
  const { rows: conflitos } = await db.execute(sql`
    SELECT id, titulo, data_reuniao, duracao_minutos FROM reunioes
    WHERE status NOT IN ('cancelada')
    ${ignorar}
      AND data_reuniao < ${fim.toISOString()}::timestamptz
      AND (data_reuniao + (duracao_minutos || ' minutes')::interval) > ${inicio.toISOString()}::timestamptz
    ORDER BY data_reuniao ASC
    LIMIT 1
  `);
  if (conflitos.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = conflitos[0] as any;
    const h = new Date(c.data_reuniao).toLocaleTimeString('pt-BR', {
      hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
    });
    return {
      conflito: true,
      tipo: 'sobreposicao',
      detalhe: `Conflito com "${c.titulo}" às ${h}`,
      reuniao_conflitante: {
        id:              parseInt(c.id),
        titulo:          c.titulo,
        data_reuniao:    String(c.data_reuniao),
        duracao_minutos: parseInt(c.duracao_minutos),
      },
    };
  }

  return { conflito: false };
}

// ── Agenda — Endpoints de Disponibilidade e Bloqueios ─────────────────────────

/**
 * GET /api/agenda/disponibilidade?data=2026-06-05&hora=14:00&duracao=60
 * Retorna se o horário está disponível + lista de ocupações do dia.
 */
app.get('/api/agenda/disponibilidade', { preHandler: autenticar }, async (request, reply) => {
  const q = request.query as Record<string, string | undefined>;
  const { data, hora, duracao } = q;

  if (!data) return reply.code(400).send({ detail: 'Parâmetro "data" obrigatório (YYYY-MM-DD).' });

  // Monta o datetime se hora foi fornecida
  let resultado: ResultadoConflito = { conflito: false };
  if (hora) {
    const dur = parseInt(duracao || '60');
    const dt  = new Date(`${data}T${hora}:00Z`);
    resultado = await verificarConflito(dt, dur);
  }

  // Reuniões do dia
  const { rows: reunioesDia } = await db.execute(sql`
    SELECT id, titulo, data_reuniao, duracao_minutos, status, farmacia_nome
    FROM (
      SELECT r.id, r.titulo, r.data_reuniao, r.duracao_minutos, r.status,
             f.nome AS farmacia_nome
      FROM reunioes r
      JOIN farmacias f ON f.id = r.farmacia_id
      WHERE r.data_reuniao::date = ${data}::date
        AND r.status NOT IN ('cancelada')
    ) sub
    ORDER BY data_reuniao ASC
  `);

  // Bloqueios do dia
  const { rows: bloqueiosDia } = await db.execute(sql`
    SELECT id, data, hora_inicio, hora_fim, dia_inteiro, motivo
    FROM agenda_bloqueios
    WHERE data = ${data}::date
    ORDER BY hora_inicio ASC NULLS FIRST
  `);

  // Slots disponíveis (08:00–18:00, blocos de 30 min)
  const horasOcupadas = new Set<string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of reunioesDia as any[]) {
    const ini = new Date(r.data_reuniao);
    const fim = new Date(ini.getTime() + parseInt(r.duracao_minutos || 60) * 60_000);
    for (let t = new Date(ini); t < fim; t = new Date(t.getTime() + 30 * 60_000)) {
      horasOcupadas.add(`${String(t.getUTCHours()).padStart(2,'0')}:${String(t.getUTCMinutes()).padStart(2,'0')}`);
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const diaBloqueado = (bloqueiosDia as any[]).some(b => b.dia_inteiro);
  const slots: { hora: string; disponivel: boolean }[] = [];
  for (let h = 8; h < 18; h++) {
    for (const m of [0, 30]) {
      const horario = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
      slots.push({ hora: horario, disponivel: !diaBloqueado && !horasOcupadas.has(horario) });
    }
  }

  return {
    data,
    disponivel:   !resultado.conflito,
    conflito:     resultado,
    reunioes_dia: reunioesDia,
    bloqueios:    bloqueiosDia,
    dia_bloqueado: diaBloqueado,
    slots,          // grade de 30 em 30 min mostrando livre/ocupado
  };
});

/**
 * GET /api/agenda/calendario?mes=2026-06
 * Visão mensal: para cada dia mostra qtd de reuniões e se está bloqueado.
 */
app.get('/api/agenda/calendario', { preHandler: autenticar }, async (request, reply) => {
  const q   = request.query as Record<string, string | undefined>;
  const mes = q.mes || new Date().toISOString().slice(0, 7); // YYYY-MM
  if (!/^\d{4}-\d{2}$/.test(mes)) return reply.code(400).send({ detail: 'Formato inválido. Use YYYY-MM.' });

  const { rows: reunioesMes } = await db.execute(sql`
    SELECT data_reuniao::date AS dia, COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE status = 'realizada')::int  AS realizadas,
           COUNT(*) FILTER (WHERE status = 'confirmada')::int AS confirmadas,
           COUNT(*) FILTER (WHERE status = 'agendada')::int   AS agendadas
    FROM reunioes
    WHERE DATE_TRUNC('month', data_reuniao) = DATE_TRUNC('month', ${mes + '-01'}::date)
      AND status != 'cancelada'
    GROUP BY data_reuniao::date
  `);

  const { rows: bloqueiosMes } = await db.execute(sql`
    SELECT data, dia_inteiro, hora_inicio, hora_fim, motivo
    FROM agenda_bloqueios
    WHERE DATE_TRUNC('month', data) = DATE_TRUNC('month', ${mes + '-01'}::date)
    ORDER BY data ASC
  `);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reunioesPorDia = Object.fromEntries((reunioesMes as any[]).map(r => [String(r.dia), r]));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bloqueiosPorDia = Object.fromEntries((bloqueiosMes as any[]).map(b => [String(b.data), b]));

  // Gera todos os dias do mês
  const [ano, mesNum] = mes.split('-').map(Number);
  const diasNoMes = new Date(ano, mesNum, 0).getDate();
  const dias = [];
  for (let d = 1; d <= diasNoMes; d++) {
    const dStr = `${mes}-${String(d).padStart(2, '0')}`;
    dias.push({
      data:         dStr,
      reunioes:     reunioesPorDia[dStr] || { total: 0, realizadas: 0, confirmadas: 0, agendadas: 0 },
      bloqueado:    !!bloqueiosPorDia[dStr]?.dia_inteiro,
      bloqueio:     bloqueiosPorDia[dStr] || null,
    });
  }

  return { mes, dias };
});

/** POST /api/agenda/bloqueios — bloqueia um dia ou intervalo de horário */
app.post('/api/agenda/bloqueios', { preHandler: [autenticar, apenasAdmin] }, async (request, reply) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = request.body as any;
  const { data, hora_inicio, hora_fim, dia_inteiro, motivo } = b;

  if (!data) return reply.code(400).send({ detail: 'Campo "data" obrigatório (YYYY-MM-DD).' });
  if (!dia_inteiro && (!hora_inicio || !hora_fim)) {
    return reply.code(400).send({ detail: 'Para bloqueio parcial, informe hora_inicio e hora_fim.' });
  }

  const [novo] = await db.insert(agendaBloqueios).values({
    data:         data,
    horaInicio:   dia_inteiro ? null : hora_inicio,
    horaFim:      dia_inteiro ? null : hora_fim,
    diaInteiro:   !!dia_inteiro,
    motivo:       motivo || null,
    criadoPorId:  request.user.id,
  }).returning();

  return reply.code(201).send({
    ...novo,
    mensagem: dia_inteiro
      ? `Dia ${data} bloqueado.`
      : `Horário ${hora_inicio}–${hora_fim} do dia ${data} bloqueado.`,
  });
});

/** GET /api/agenda/bloqueios — lista bloqueios (com filtro opcional de mês) */
app.get('/api/agenda/bloqueios', { preHandler: autenticar }, async (request) => {
  const q   = request.query as Record<string, string | undefined>;
  const mes = q.mes;

  const filtroMes = mes
    ? sql`WHERE DATE_TRUNC('month', data) = DATE_TRUNC('month', ${mes + '-01'}::date)`
    : sql`WHERE data >= CURRENT_DATE - INTERVAL '7 days'`;

  const { rows } = await db.execute(sql`
    SELECT ab.*, g.nome AS criado_por_nome
    FROM agenda_bloqueios ab
    LEFT JOIN gestores_trafego g ON g.id = ab.criado_por_id
    ${filtroMes}
    ORDER BY data ASC, hora_inicio ASC NULLS FIRST
  `);
  return rows;
});

/** DELETE /api/agenda/bloqueios/:id — remove um bloqueio (somente admin) */
app.delete('/api/agenda/bloqueios/:id', { preHandler: [autenticar, apenasAdmin] }, async (request, reply) => {
  const id = parseInt((request.params as { id: string }).id, 10);
  const [existe] = await db.select().from(agendaBloqueios).where(eq(agendaBloqueios.id, id));
  if (!existe) return reply.code(404).send({ detail: 'Bloqueio não encontrado.' });

  await db.delete(agendaBloqueios).where(eq(agendaBloqueios.id, id));
  return { mensagem: 'Bloqueio removido.' };
});

/**
 * GET /api/agenda/verificar?data=2026-06-05T14:00:00Z&duracao=60&reuniao_id=5
 * Endpoint rápido de verificação — o frontend chama ao selecionar data/hora no modal.
 */
app.get('/api/agenda/verificar', { preHandler: autenticar }, async (request, reply) => {
  const q = request.query as Record<string, string | undefined>;
  if (!q.data) return reply.code(400).send({ detail: 'Parâmetro "data" obrigatório (ISO 8601).' });

  const dt      = new Date(q.data);
  const dur     = parseInt(q.duracao || '60');
  const ignorar = q.reuniao_id ? parseInt(q.reuniao_id) : undefined;

  if (isNaN(dt.getTime())) return reply.code(400).send({ detail: 'Data inválida.' });

  const resultado = await verificarConflito(dt, dur, ignorar);
  return resultado;
});

// ── Reuniões CRUD ─────────────────────────────────────────────────────────────

/** Stats rápidas (deve vir ANTES de /:id para não conflitar) */
app.get('/api/reunioes/stats', { preHandler: autenticar }, async (request) => {
  const filtroGid = request.user.isAdmin
    ? null
    : request.user.id;

  const filtroSql = filtroGid
    ? sql`AND (r.gestor_id = ${filtroGid} OR r.criado_por_id = ${filtroGid})`
    : sql``;

  const agora       = new Date();
  const inicioMes   = new Date(agora.getFullYear(), agora.getMonth(), 1);

  const { rows } = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE r.data_reuniao >= ${inicioMes.toISOString()}
                         AND r.status != 'cancelada')               AS reunioes_mes,
      COUNT(*) FILTER (WHERE r.status = 'realizada')                AS total_realizadas,
      COUNT(*) FILTER (WHERE r.data_reuniao >  NOW()
                         AND r.status IN ('agendada','confirmada')) AS agendadas_futuras,
      COUNT(*) FILTER (WHERE r.status = 'confirmada'
                         AND r.data_reuniao > NOW())                AS confirmadas_futuras
    FROM reunioes r ${filtroSql}
  `);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = (rows as any[])[0] || {};
  return {
    reunioes_mes:       parseInt(s.reunioes_mes       || 0),
    total_realizadas:   parseInt(s.total_realizadas   || 0),
    agendadas_futuras:  parseInt(s.agendadas_futuras  || 0),
    confirmadas_futuras:parseInt(s.confirmadas_futuras|| 0),
  };
});

/** Lista reuniões com filtros */
app.get('/api/reunioes', { preHandler: autenticar }, async (request) => {
  const q = request.query as Record<string, string | undefined>;
  const { farmacia_id, status, mes } = q;

  // Filtros como sql fragments com parâmetros seguros (evita o bug do params[])
  const userFilter = !request.user.isAdmin
    ? sql`AND (r.gestor_id = ${request.user.id} OR r.criado_por_id = ${request.user.id})`
    : sql``;

  const farmaciaFilter = farmacia_id
    ? sql`AND r.farmacia_id = ${parseInt(farmacia_id)}`
    : sql``;

  const statusFilter = status
    ? sql`AND r.status = ${status}`
    : sql``;

  const mesFilter = mes
    ? sql`AND DATE_TRUNC('month', r.data_reuniao) = DATE_TRUNC('month', ${mes + '-01'}::date)`
    : sql``;

  const { rows } = await db.execute(sql`
    SELECT r.*,
           f.nome   AS farmacia_nome,
           g.nome   AS gestor_nome,
           cp.nome  AS criado_por_nome
    FROM reunioes r
    JOIN farmacias f       ON f.id  = r.farmacia_id
    LEFT JOIN gestores_trafego g  ON g.id  = r.gestor_id
    LEFT JOIN gestores_trafego cp ON cp.id = r.criado_por_id
    WHERE 1=1
    ${userFilter}
    ${farmaciaFilter}
    ${statusFilter}
    ${mesFilter}
    ORDER BY r.data_reuniao DESC
  `);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (rows as any[]).map(r => ({
    ...r,
    google_link: googleCalendarLink({
      titulo:         r.titulo,
      descricao:      r.descricao,
      dataReuniao:    r.data_reuniao,
      duracaoMinutos: r.duracao_minutos,
      local:          r.local,
      linkMeet:       r.link_meet,
    }),
  }));
});

/** Cria nova reunião */
app.post('/api/reunioes', { preHandler: autenticar }, async (request, reply) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = request.body as any;
  const { farmacia_id, gestor_id, titulo, descricao, data_reuniao,
          duracao_minutos, local, link_meet } = b;

  if (!farmacia_id || !titulo || !data_reuniao) {
    return reply.code(400).send({ detail: 'farmacia_id, titulo e data_reuniao são obrigatórios.' });
  }

  // Gestor não-admin só pode criar para farmácias que ele gerencia
  if (!request.user.isAdmin) {
    const [f] = await db.select().from(farmacias).where(
      and(eq(farmacias.id, parseInt(farmacia_id)), eq(farmacias.gestorId, request.user.id))
    );
    if (!f) return reply.code(403).send({ detail: 'Acesso negado a esta farmácia.' });
  }

  const dataReuniaoDate = new Date(data_reuniao);
  const duracaoMin      = duracao_minutos ? parseInt(duracao_minutos) : 60;

  // ── Verifica conflito ANTES de salvar ────────────────────────────────────
  const conflito = await verificarConflito(dataReuniaoDate, duracaoMin);
  if (conflito.conflito) {
    return reply.code(409).send({
      detail:              conflito.detalhe,
      tipo_conflito:       conflito.tipo,
      reuniao_conflitante: conflito.reuniao_conflitante ?? null,
    });
  }

  const [nova] = await db.insert(reunioes).values({
    farmaciaId:     parseInt(farmacia_id),
    gestorId:       gestor_id ? parseInt(gestor_id) : request.user.id,
    criadoPorId:    request.user.id,
    titulo:         String(titulo),
    descricao:      descricao ?? null,
    dataReuniao:    dataReuniaoDate,
    duracaoMinutos: duracaoMin,
    local:          local ?? null,
    linkMeet:       link_meet ?? null,
    status:         'agendada',
  }).returning();

  // Tenta sincronizar automaticamente se o gestor tiver o Google conectado
  const targetGestorId = nova.gestorId ?? request.user.id;
  const eventId = await syncGoogleEvent(targetGestorId, nova.id)
    .catch(() => null);

  return reply.code(201).send({
    ...nova,
    google_link: googleCalendarLink({
      titulo: nova.titulo, descricao: nova.descricao,
      dataReuniao: nova.dataReuniao, duracaoMinutos: nova.duracaoMinutos,
      local: nova.local, linkMeet: nova.linkMeet,
    }),
    google_event_sincronizado: !!eventId,
  });
});

/** Busca reunião por ID */
app.get('/api/reunioes/:id', { preHandler: autenticar }, async (request, reply) => {
  const id = parseInt((request.params as { id: string }).id, 10);

  const { rows } = await db.execute(sql`
    SELECT r.*,
           f.nome   AS farmacia_nome,
           g.nome   AS gestor_nome,
           cp.nome  AS criado_por_nome
    FROM reunioes r
    JOIN farmacias f       ON f.id  = r.farmacia_id
    LEFT JOIN gestores_trafego g  ON g.id  = r.gestor_id
    LEFT JOIN gestores_trafego cp ON cp.id = r.criado_por_id
    WHERE r.id = ${id}
  `);

  if (!rows.length) return reply.code(404).send({ detail: 'Reunião não encontrada.' });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = rows[0] as any;

  // Gestor não-admin só acessa se for o gestor ou o criador
  if (!request.user.isAdmin &&
      r.gestor_id !== request.user.id &&
      r.criado_por_id !== request.user.id) {
    return reply.code(403).send({ detail: 'Acesso negado.' });
  }

  return {
    ...r,
    google_link: googleCalendarLink({
      titulo: r.titulo, descricao: r.descricao,
      dataReuniao: r.data_reuniao, duracaoMinutos: r.duracao_minutos,
      local: r.local, linkMeet: r.link_meet,
    }),
  };
});

/** Atualiza dados da reunião */
app.put('/api/reunioes/:id', { preHandler: autenticar }, async (request, reply) => {
  const id = parseInt((request.params as { id: string }).id, 10);
  const [existe] = await db.select().from(reunioes).where(eq(reunioes.id, id));
  if (!existe) return reply.code(404).send({ detail: 'Reunião não encontrada.' });

  if (!request.user.isAdmin &&
      existe.gestorId    !== request.user.id &&
      existe.criadoPorId !== request.user.id) {
    return reply.code(403).send({ detail: 'Acesso negado.' });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = request.body as any;
  const dados: Partial<typeof reunioes.$inferInsert> = {};
  if (b.titulo          !== undefined) dados.titulo         = b.titulo;
  if (b.descricao       !== undefined) dados.descricao      = b.descricao;
  if (b.data_reuniao    !== undefined) dados.dataReuniao    = new Date(b.data_reuniao);
  if (b.duracao_minutos !== undefined) dados.duracaoMinutos = parseInt(b.duracao_minutos);
  if (b.local           !== undefined) dados.local          = b.local;
  if (b.link_meet       !== undefined) dados.linkMeet       = b.link_meet;
  if (b.observacoes     !== undefined) dados.observacoes    = b.observacoes;
  if (b.gestor_id       !== undefined) dados.gestorId       = parseInt(b.gestor_id);

  if (Object.keys(dados).length) {
    // Se mudou data/hora ou duração, revalida conflito
    if (dados.dataReuniao || dados.duracaoMinutos) {
      const novaData = dados.dataReuniao ?? existe.dataReuniao;
      const novaDur  = dados.duracaoMinutos ?? existe.duracaoMinutos ?? 60;
      const conflito = await verificarConflito(new Date(novaData!), novaDur, id);
      if (conflito.conflito) {
        return reply.code(409).send({
          detail:              conflito.detalhe,
          tipo_conflito:       conflito.tipo,
          reuniao_conflitante: conflito.reuniao_conflitante ?? null,
        });
      }
    }
    await db.update(reunioes).set(dados).where(eq(reunioes.id, id));
    // Re-sincroniza com Google Calendar se conectado
    const targetGestor = dados.gestorId ?? existe.gestorId ?? request.user.id;
    await syncGoogleEvent(targetGestor, id).catch(() => null);
  }

  const [atualizada] = await db.select().from(reunioes).where(eq(reunioes.id, id));
  return {
    ...atualizada,
    google_link: googleCalendarLink({
      titulo: atualizada.titulo, descricao: atualizada.descricao,
      dataReuniao: atualizada.dataReuniao, duracaoMinutos: atualizada.duracaoMinutos,
      local: atualizada.local, linkMeet: atualizada.linkMeet,
    }),
  };
});

/** Confirma reunião (agendada → confirmada) */
app.patch('/api/reunioes/:id/confirmar', { preHandler: autenticar }, async (request, reply) => {
  const id = parseInt((request.params as { id: string }).id, 10);
  const [existe] = await db.select().from(reunioes).where(eq(reunioes.id, id));
  if (!existe) return reply.code(404).send({ detail: 'Reunião não encontrada.' });
  if (existe.status === 'cancelada') return reply.code(400).send({ detail: 'Reunião cancelada não pode ser confirmada.' });

  if (!request.user.isAdmin &&
      existe.gestorId    !== request.user.id &&
      existe.criadoPorId !== request.user.id) {
    return reply.code(403).send({ detail: 'Acesso negado.' });
  }

  await db.update(reunioes).set({ status: 'confirmada' }).where(eq(reunioes.id, id));
  await syncGoogleEvent(existe.gestorId ?? request.user.id, id).catch(() => null);

  return { id, status: 'confirmada', mensagem: 'Reunião confirmada.' };
});

/** Marca reunião como realizada */
app.patch('/api/reunioes/:id/realizar', { preHandler: autenticar }, async (request, reply) => {
  const id = parseInt((request.params as { id: string }).id, 10);
  const [existe] = await db.select().from(reunioes).where(eq(reunioes.id, id));
  if (!existe) return reply.code(404).send({ detail: 'Reunião não encontrada.' });
  if (existe.status === 'cancelada') return reply.code(400).send({ detail: 'Reunião cancelada não pode ser marcada como realizada.' });

  if (!request.user.isAdmin &&
      existe.gestorId    !== request.user.id &&
      existe.criadoPorId !== request.user.id) {
    return reply.code(403).send({ detail: 'Acesso negado.' });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = request.body as any;
  await db.update(reunioes).set({
    status:      'realizada',
    observacoes: b?.observacoes ?? existe.observacoes,
  }).where(eq(reunioes.id, id));

  return { id, status: 'realizada', mensagem: 'Reunião marcada como realizada.' };
});

/** Cancela reunião */
app.patch('/api/reunioes/:id/cancelar', { preHandler: autenticar }, async (request, reply) => {
  const id = parseInt((request.params as { id: string }).id, 10);
  const [existe] = await db.select().from(reunioes).where(eq(reunioes.id, id));
  if (!existe) return reply.code(404).send({ detail: 'Reunião não encontrada.' });
  if (existe.status === 'realizada') return reply.code(400).send({ detail: 'Reunião realizada não pode ser cancelada.' });

  if (!request.user.isAdmin &&
      existe.gestorId    !== request.user.id &&
      existe.criadoPorId !== request.user.id) {
    return reply.code(403).send({ detail: 'Acesso negado.' });
  }

  await db.update(reunioes).set({ status: 'cancelada' }).where(eq(reunioes.id, id));
  // Remove do Google Calendar se existir
  await deleteGoogleEvent(existe.gestorId ?? request.user.id, id).catch(() => null);

  return { id, status: 'cancelada', mensagem: 'Reunião cancelada.' };
});

/** Gera link direto de "Adicionar ao Google Calendar" para uma reunião */
app.get('/api/reunioes/:id/google-link', { preHandler: autenticar }, async (request, reply) => {
  const id = parseInt((request.params as { id: string }).id, 10);
  const [r] = await db.select().from(reunioes).where(eq(reunioes.id, id));
  if (!r) return reply.code(404).send({ detail: 'Reunião não encontrada.' });

  return {
    link: googleCalendarLink({
      titulo: r.titulo, descricao: r.descricao,
      dataReuniao: r.dataReuniao, duracaoMinutos: r.duracaoMinutos,
      local: r.local, linkMeet: r.linkMeet,
    }),
  };
});

/** Força sincronização manual de uma reunião com o Google Calendar do gestor */
app.post('/api/reunioes/:id/sync-google', { preHandler: autenticar }, async (request, reply) => {
  const id = parseInt((request.params as { id: string }).id, 10);
  const [r] = await db.select().from(reunioes).where(eq(reunioes.id, id));
  if (!r) return reply.code(404).send({ detail: 'Reunião não encontrada.' });

  if (!GOOGLE_CLIENT_ID) {
    return reply.code(503).send({ detail: 'Google Calendar não configurado no servidor.' });
  }

  const targetGestorId = r.gestorId ?? request.user.id;
  try {
    const eventId = await syncGoogleEvent(targetGestorId, id);
    if (!eventId) {
      return reply.code(424).send({
        detail: 'Google Calendar não conectado. Acesse /api/auth/google para autorizar.',
      });
    }
    return { google_event_id: eventId, mensagem: 'Evento sincronizado com sucesso.' };
  } catch (e) {
    logger.error({ err: e }, 'Erro ao sincronizar com Google Calendar');
    return reply.code(502).send({ detail: 'Erro ao comunicar com o Google Calendar.' });
  }
});

// ── Dashboard — Gráficos de Vendas e Reuniões ─────────────────────────────────

/**
 * GET /api/dashboard/evolucao
 * Retorna séries temporais de vendas para os períodos de 7 e 30 dias.
 * Usado para gráfico de linha/barra mostrando evolução ao longo do tempo.
 */
app.get('/api/dashboard/evolucao', { preHandler: autenticar }, async (request) => {
  const q         = request.query as Record<string, string | undefined>;
  const filtroGid = request.user.isAdmin
    ? (q.gestor_id ? sql`AND f.gestor_id = ${parseInt(q.gestor_id)}` : sql``)
    : sql`AND f.gestor_id = ${request.user.id}`;

  // Todas as coletas dos últimos 90 dias para períodos de 7 e 30 dias
  const { rows } = await db.execute(sql`
    SELECT
      c.data_coleta::date                AS data,
      c.periodo_dias,
      SUM(c.vendas_realizadas)::int      AS vendas,
      ROUND(SUM(c.receita_total), 2)     AS receita,
      SUM(c.total_atendimentos)::int     AS atendimentos,
      COUNT(DISTINCT c.farmacia_id)::int AS farmacias
    FROM coletas c
    JOIN farmacias f ON f.id = c.farmacia_id
    WHERE f.ativa = TRUE
      AND c.periodo_dias IN (7, 30)
      AND c.data_coleta >= NOW() - INTERVAL '90 days'
      ${filtroGid}
    GROUP BY c.data_coleta::date, c.periodo_dias
    ORDER BY data ASC, c.periodo_dias ASC
  `);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapPonto = (r: any) => ({
    data:         String(r.data),
    vendas:       parseInt(r.vendas       || 0),
    receita:      parseFloat(r.receita    || 0),
    atendimentos: parseInt(r.atendimentos || 0),
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const serie7d  = (rows as any[]).filter(r => parseInt(r.periodo_dias) === 7).map(mapPonto);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const serie30d = (rows as any[]).filter(r => parseInt(r.periodo_dias) === 30).map(mapPonto);

  const ultimo7d  = serie7d[serie7d.length   - 1] ?? null;
  const ultimo30d = serie30d[serie30d.length - 1] ?? null;

  // Variação: compara a última semana (7d) com a proporção equivalente do mês (30d / 4)
  const varVendas  = ultimo7d && ultimo30d && ultimo30d.vendas  > 0
    ? Math.round((ultimo7d.vendas  / (ultimo30d.vendas  / 4) - 1) * 1000) / 10 : null;
  const varReceita = ultimo7d && ultimo30d && ultimo30d.receita > 0
    ? Math.round((ultimo7d.receita / (ultimo30d.receita / 4) - 1) * 1000) / 10 : null;

  return {
    serie_7d:         serie7d,
    serie_30d:        serie30d,
    ultimo_7d:        ultimo7d,
    ultimo_30d:       ultimo30d,
    variacao_vendas:  varVendas,
    variacao_receita: varReceita,
  };
});

/**
 * GET /api/dashboard/reunioes-perda
 * Taxa de reuniões canceladas ("perdidas") globais e por farmácia.
 * Usado para gráfico de donut + ranking de perda por farmácia.
 */
app.get('/api/dashboard/reunioes-perda', { preHandler: autenticar }, async (request) => {
  const filtroGid = request.user.isAdmin
    ? sql``
    : sql`AND (r.gestor_id = ${request.user.id} OR r.criado_por_id = ${request.user.id})`;

  // Totais globais dos últimos 90 dias
  const { rows: statsRows } = await db.execute(sql`
    SELECT
      COUNT(*)::int                                                      AS total,
      COUNT(*) FILTER (WHERE r.status = 'realizada')::int               AS realizadas,
      COUNT(*) FILTER (WHERE r.status = 'cancelada')::int               AS canceladas,
      COUNT(*) FILTER (WHERE r.status = 'confirmada')::int              AS confirmadas,
      COUNT(*) FILTER (WHERE r.status = 'agendada')::int                AS agendadas
    FROM reunioes r
    WHERE r.criado_em >= NOW() - INTERVAL '90 days'
    ${filtroGid}
  `);

  // Breakdown por farmácia (top 10)
  const { rows: porFarmaciaRows } = await db.execute(sql`
    SELECT
      f.nome                                                             AS farmacia_nome,
      COUNT(*)::int                                                      AS total,
      COUNT(*) FILTER (WHERE r.status = 'realizada')::int               AS realizadas,
      COUNT(*) FILTER (WHERE r.status = 'cancelada')::int               AS canceladas,
      COUNT(*) FILTER (WHERE r.status IN ('agendada','confirmada'))::int AS pendentes
    FROM reunioes r
    JOIN farmacias f ON f.id = r.farmacia_id
    WHERE r.criado_em >= NOW() - INTERVAL '90 days'
    ${filtroGid}
    GROUP BY f.id, f.nome
    ORDER BY total DESC
    LIMIT 10
  `);

  // Evolução mensal das reuniões (últimos 6 meses)
  const { rows: evolucaoRows } = await db.execute(sql`
    SELECT
      TO_CHAR(DATE_TRUNC('month', r.criado_em), 'YYYY-MM')             AS mes,
      COUNT(*)::int                                                      AS total,
      COUNT(*) FILTER (WHERE r.status = 'realizada')::int               AS realizadas,
      COUNT(*) FILTER (WHERE r.status = 'cancelada')::int               AS canceladas
    FROM reunioes r
    WHERE r.criado_em >= NOW() - INTERVAL '6 months'
    ${filtroGid}
    GROUP BY DATE_TRUNC('month', r.criado_em)
    ORDER BY mes ASC
  `);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s       = (statsRows as any[])[0] || {};
  const total    = parseInt(s.total     || 0);
  const canceladas = parseInt(s.canceladas || 0);
  const realizadas = parseInt(s.realizadas || 0);

  return {
    // KPIs globais
    total,
    realizadas,
    canceladas,
    confirmadas:      parseInt(s.confirmadas || 0),
    agendadas:        parseInt(s.agendadas   || 0),
    taxa_realizacao:  total > 0 ? Math.round(realizadas  / total * 1000) / 10 : 0,
    taxa_perda:       total > 0 ? Math.round(canceladas  / total * 1000) / 10 : 0,

    // Donut chart: distribuição de status
    distribuicao: [
      { status: 'Realizadas',  valor: realizadas,               cor: '#10B981' },
      { status: 'Canceladas',  valor: canceladas,               cor: '#EF4444' },
      { status: 'Confirmadas', valor: parseInt(s.confirmadas || 0), cor: '#3B82F6' },
      { status: 'Agendadas',   valor: parseInt(s.agendadas   || 0), cor: '#F59E0B' },
    ].filter(d => d.valor > 0),

    // Ranking de perda por farmácia
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    por_farmacia: (porFarmaciaRows as any[]).map(r => ({
      farmacia_nome: r.farmacia_nome,
      total:         parseInt(r.total      || 0),
      realizadas:    parseInt(r.realizadas || 0),
      canceladas:    parseInt(r.canceladas || 0),
      pendentes:     parseInt(r.pendentes  || 0),
      taxa_perda:    parseInt(r.total || 0) > 0
        ? Math.round(parseInt(r.canceladas || 0) / parseInt(r.total || 0) * 1000) / 10
        : 0,
    })),

    // Evolução mensal para gráfico de linha
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    evolucao_mensal: (evolucaoRows as any[]).map(r => ({
      mes:        r.mes,
      total:      parseInt(r.total      || 0),
      realizadas: parseInt(r.realizadas || 0),
      canceladas: parseInt(r.canceladas || 0),
      taxa_perda: parseInt(r.total || 0) > 0
        ? Math.round(parseInt(r.canceladas || 0) / parseInt(r.total || 0) * 1000) / 10
        : 0,
    })),
  };
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
