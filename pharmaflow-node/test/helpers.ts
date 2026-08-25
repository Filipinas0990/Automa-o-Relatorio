/**
 * Utilitários das suítes: criar dados isolados por teste e falar com a API.
 *
 * Usa `app.inject()` do Fastify — exercita o roteamento, os preHandlers de
 * autenticação e os handlers de verdade, sem abrir socket.
 */
import jwt from 'jsonwebtoken';
import { sql } from 'drizzle-orm';
import { db } from '../src/database/db';
import { app } from '../src/api';
import {
  gestoresTrafego, farmacias, catalogoProdutos, catalogoCategorias,
  linksOferta, solicitacoesOferta,
  disparosGrupo, disparosGrupoLog, gestorWhatsapp,
} from '../src/database/schema';

const JWT_SECRET = process.env.JWT_SECRET_KEY || 'segredo-de-teste';

/** Token igual ao que o /api/auth/login emite (mesmo payload e segredo). */
export function tokenDe(gestorId: number, nome = 'Teste', isAdmin = false): string {
  return jwt.sign({ sub: String(gestorId), nome, is_admin: isAdmin }, JWT_SECRET, { expiresIn: '1h' });
}

let seq = 0;
/** Sufixo único — evita colisão em colunas UNIQUE entre testes. */
function unico(): string {
  seq += 1;
  return `${Date.now().toString(36)}${seq}`;
}

export async function criarGestor(opts: { nome?: string; isAdmin?: boolean } = {}) {
  const id = unico();
  const [g] = await db.insert(gestoresTrafego).values({
    nome:      opts.nome ?? `Gestor ${id}`,
    email:     `gestor-${id}@teste.local`,
    senhaHash: 'nao-usado-nos-testes',
    isAdmin:   opts.isAdmin ?? false,
    ativo:     true,
  }).returning();

  return { ...g, token: tokenDe(g.id, g.nome, g.isAdmin) };
}

export async function criarFarmacia(gestorId: number, opts: { nome?: string; telefone?: string } = {}) {
  const [f] = await db.insert(farmacias).values({
    nome:     opts.nome ?? `Farmácia ${unico()}`,
    gestorId,
    ativa:    true,
    telefone: opts.telefone ?? null,
  }).returning();
  return f;
}

export async function criarProduto(
  nome = `Produto ${unico()}`,
  categoria: string | null = null,
) {
  const [p] = await db.insert(catalogoProdutos).values({
    nome,
    nomeNorm:  nome.toLowerCase(),
    imagemB64: Buffer.from('imagem-falsa').toString('base64'),
    mime:      'image/png',
    categoria,
  }).returning();
  return p;
}

/** Cria uma solicitação já enviada por um dono, direto no banco. */
export async function criarSolicitacao(
  gestorId: number,
  farmaciaId: number,
  produtos: { id: number; nome: string }[] = [],
) {
  const [s] = await db.insert(solicitacoesOferta).values({
    gestorId,
    farmaciaId,
    produtosJson: JSON.stringify(produtos),
    status:       'pendente',
  }).returning();
  return s;
}

/** Marca o WhatsApp do gestor como conectado, sem falar com a Evolution. */
export async function conectarWhatsappFake(gestorId: number) {
  const [i] = await db.insert(gestorWhatsapp).values({
    gestorId,
    instanceName: `gestor_${gestorId}`,
    status:       'open',
  }).returning();
  return i;
}

// ── Chamadas HTTP ─────────────────────────────────────────────────────────────

interface OpcoesReq {
  token?: string;
  body?: unknown;
}

export async function api(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  opts: OpcoesReq = {},
) {
  const res = await app.inject({
    method,
    url,
    headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
    payload: opts.body as never,
  });

  let json: unknown = null;
  try { json = res.json(); } catch { /* resposta sem corpo JSON */ }

  return { status: res.statusCode, body: json as never, raw: res };
}

/** Zera as tabelas que os testes escrevem. Chamar no beforeEach. */
export async function limparBanco(): Promise<void> {
  await db.execute(sql`
    TRUNCATE ${disparosGrupoLog}, ${disparosGrupo}, ${solicitacoesOferta},
             ${linksOferta}, ${gestorWhatsapp}, ${catalogoProdutos},
             ${catalogoCategorias},
             ${farmacias}, ${gestoresTrafego}
    RESTART IDENTITY CASCADE
  `);
}
