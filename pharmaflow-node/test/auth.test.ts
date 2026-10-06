/**
 * Login e sessão (src/api/sessao.ts).
 *
 * O que se protege: o token só existe no cookie httpOnly (nunca no corpo do
 * login nem aceito pela URL), quem erra a senha muitas vezes é barrado, a
 * sessão se renova sozinha com o uso, e gestor comum não lista os colegas.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { app } from '../src/api';
import { db } from '../src/database/db';
import { gestoresTrafego } from '../src/database/schema';
import { criarStateGoogle, lerStateGoogle, COOKIE_SESSAO } from '../src/api/sessao';
import { api, criarGestor, limparBanco } from './helpers';

const SENHA = 'senha-certa-123';
const SEGREDO = process.env.JWT_SECRET_KEY as string;

let seq = 0;
async function gestorComSenha(isAdmin = false) {
  seq += 1;
  const email = `login-${Date.now().toString(36)}${seq}@teste.local`;
  const [g] = await db.insert(gestoresTrafego).values({
    nome: 'Gestor Login', email, senhaHash: await bcrypt.hash(SENHA, 4), isAdmin, ativo: true,
  }).returning();
  return g;
}

function login(email: string, senha: string) {
  return app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, senha } });
}

/** "pf_sessao=<jwt>" tirado do Set-Cookie, pronto para mandar no header Cookie. */
function cookieDe(res: { headers: Record<string, unknown> }): string {
  const sc = String(res.headers['set-cookie'] ?? '');
  return sc.split(';')[0];
}

describe('Login e sessão', () => {
  beforeEach(limparBanco);

  it('grava a sessão num cookie httpOnly e não devolve o token no corpo', async () => {
    const g = await gestorComSenha();
    const res = await login(g.email, SENHA);

    expect(res.statusCode).toBe(200);
    expect(res.json()).not.toHaveProperty('access_token');
    const sc = String(res.headers['set-cookie']);
    expect(sc).toContain(`${COOKIE_SESSAO}=`);
    expect(sc).toContain('HttpOnly');
    expect(sc).toContain('Secure');
    expect(sc).toContain('SameSite=Strict');

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: cookieDe(res) } });
    expect(me.statusCode).toBe(200);
    expect(me.json().id).toBe(g.id);
  });

  it('não aceita mais o token pela URL', async () => {
    const g = await criarGestor();
    const res = await app.inject({ method: 'GET', url: `/api/auth/me?token=${g.token}` });
    expect(res.statusCode).toBe(401);
  });

  it('logout apaga o cookie', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/logout' });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers['set-cookie'])).toContain('Max-Age=0');
  });

  it('barra o e-mail depois de 5 senhas erradas, mesmo que a 6ª esteja certa', async () => {
    const g = await gestorComSenha();
    for (let i = 0; i < 5; i++) {
      expect((await login(g.email, 'errada')).statusCode).toBe(401);
    }
    const bloqueado = await login(g.email, SENHA);
    expect(bloqueado.statusCode).toBe(429);
    expect(bloqueado.headers['retry-after']).toBeDefined();
  });

  it('acerto antes do limite zera a contagem', async () => {
    const g = await gestorComSenha();
    for (let i = 0; i < 4; i++) await login(g.email, 'errada');
    expect((await login(g.email, SENHA)).statusCode).toBe(200);
    for (let i = 0; i < 4; i++) await login(g.email, 'errada');
    expect((await login(g.email, SENHA)).statusCode).toBe(200);
  });

  it('renova o cookie de quem está usando o sistema', async () => {
    const g = await criarGestor();
    const umaHoraAtras = Math.floor(Date.now() / 1000) - 3600;
    const antigo = jwt.sign(
      { sub: String(g.id), nome: g.nome, is_admin: false, ini: umaHoraAtras, iat: umaHoraAtras },
      SEGREDO, { expiresIn: '8h' },
    );
    const res = await app.inject({
      method: 'GET', url: '/api/auth/me', headers: { cookie: `${COOKIE_SESSAO}=${antigo}` },
    });
    expect(res.statusCode).toBe(200);
    const novo = cookieDe(res).split('=')[1];
    expect(novo).toBeTruthy();
    expect(novo).not.toBe(antigo);
    // A renovação preserva o momento do login, para a vida máxima continuar valendo
    expect((jwt.decode(novo) as { ini: number }).ini).toBe(umaHoraAtras);
  });

  it('não renova depois da vida máxima de 7 dias', async () => {
    const g = await criarGestor();
    const agora = Math.floor(Date.now() / 1000);
    const velho = jwt.sign(
      { sub: String(g.id), nome: g.nome, is_admin: false, ini: agora - 8 * 86400, iat: agora - 3600 },
      SEGREDO, { expiresIn: '8h' },
    );
    const res = await app.inject({
      method: 'GET', url: '/api/auth/me', headers: { cookie: `${COOKIE_SESSAO}=${velho}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});

describe('Lista de gestores', () => {
  beforeEach(limparBanco);

  it('gestor comum vê só a si mesmo; admin vê todos', async () => {
    const admin = await criarGestor({ isAdmin: true });
    const a = await criarGestor();
    await criarGestor();

    const comum = await api('GET', '/api/gestores', { token: a.token });
    expect(comum.status).toBe(200);
    expect((comum.body as { id: number }[]).map((g) => g.id)).toEqual([a.id]);

    const todos = await api('GET', '/api/gestores', { token: admin.token });
    expect((todos.body as unknown[]).length).toBe(3);
  });
});

describe('state do OAuth do Google', () => {
  it('recusa o state antigo (id em base64, sem assinatura)', () => {
    expect(lerStateGoogle(Buffer.from('1').toString('base64url'))).toBeNull();
    expect(lerStateGoogle(criarStateGoogle(42))).toBe(42);
  });

  it('um state não serve como sessão', async () => {
    const g = await criarGestor();
    const res = await api('GET', '/api/auth/me', { token: criarStateGoogle(g.id) });
    expect(res.status).toBe(401);
  });
});
