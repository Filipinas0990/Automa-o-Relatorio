/**
 * Sessão do gestor — JWT dentro de um cookie httpOnly.
 *
 * O token não fica mais no localStorage: o JavaScript da página não consegue
 * lê-lo, então um script injetado (XSS) não tem como roubar a sessão. O front
 * fala com a API pela mesma origem (proxy da Vercel / proxy do vite), e o
 * navegador manda o cookie sozinho — inclusive em <img src> e EventSource,
 * que antes precisavam do token na URL.
 *
 * SameSite=Strict: o cookie não acompanha pedidos vindos de outro site, o que
 * fecha a porta para CSRF (um formulário de outro domínio postando aqui).
 * Sem Domain de propósito: o cookie fica preso ao domínio do front, que é onde
 * o navegador enxerga a resposta através do proxy.
 *
 * O header `Authorization: Bearer` continua aceito para scripts e testes.
 */
import jwt from 'jsonwebtoken';
import type { FastifyReply, FastifyRequest } from 'fastify';

export const COOKIE_SESSAO = 'pf_sessao';

const SEGREDO_MINIMO = 32;

/** Sem segredo forte o servidor não sobe: assinar com um valor padrão deixaria qualquer um forjar tokens. */
function lerSegredo(): string {
  const segredo = (process.env.JWT_SECRET_KEY ?? '').trim();
  if (segredo.length < SEGREDO_MINIMO) {
    throw new Error(
      `JWT_SECRET_KEY ausente ou curta demais (mínimo ${SEGREDO_MINIMO} caracteres). ` +
      'Gere uma com: openssl rand -base64 48',
    );
  }
  return segredo;
}

export const JWT_SECRET = lerSegredo();

/** Sem uso por esse tempo, a sessão expira. */
const INATIVIDADE_SEG = 8 * 60 * 60;
/** Renova o cookie no máximo uma vez a cada 30 min, não a cada pedido. */
const RENOVAR_APOS_SEG = 30 * 60;
/** Mesmo em uso contínuo, pede login de novo depois de 7 dias. */
const VIDA_MAXIMA_SEG = 7 * 24 * 60 * 60;

export interface PayloadSessao {
  sub: string;
  nome: string;
  is_admin: boolean;
  /** Momento do login (segundos). Não muda nas renovações. */
  ini: number;
  iat: number;
  exp: number;
}

function agora(): number {
  return Math.floor(Date.now() / 1000);
}

export function criarToken(gestorId: number, nome: string, isAdmin: boolean, ini = agora()): string {
  return jwt.sign({ sub: String(gestorId), nome, is_admin: isAdmin, ini }, JWT_SECRET, {
    expiresIn: INATIVIDADE_SEG,
  });
}

export function gravarCookieSessao(reply: FastifyReply, token: string): void {
  reply.header(
    'Set-Cookie',
    `${COOKIE_SESSAO}=${token}; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=${INATIVIDADE_SEG}`,
  );
}

export function apagarCookieSessao(reply: FastifyReply): void {
  reply.header('Set-Cookie', `${COOKIE_SESSAO}=; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
}

function lerCookie(request: FastifyRequest, nome: string): string | null {
  const cabecalho = request.headers.cookie;
  if (!cabecalho) return null;
  for (const parte of cabecalho.split(';')) {
    const i = parte.indexOf('=');
    if (i > 0 && parte.slice(0, i).trim() === nome) return parte.slice(i + 1).trim() || null;
  }
  return null;
}

/** Token do pedido: header Bearer (scripts/testes) ou cookie de sessão (navegador). Nunca pela URL. */
export function tokenDoPedido(request: FastifyRequest): string | null {
  const auth = request.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return lerCookie(request, COOKIE_SESSAO);
}

export function verificarToken(token: string): PayloadSessao {
  const p = jwt.verify(token, JWT_SECRET) as PayloadSessao & { uso?: string };
  // Um state do Google é assinado com o mesmo segredo, mas não é sessão.
  if (p.uso) throw new Error('token não é de sessão');
  return p;
}

/**
 * Renovação deslizante: quem está usando o sistema não cai no meio do
 * trabalho. Só vale para o cookie — quem manda Bearer cuida do próprio token.
 */
export function renovarSeNecessario(request: FastifyRequest, reply: FastifyReply, p: PayloadSessao): void {
  if (request.headers.authorization?.startsWith('Bearer ')) return;
  const t = agora();
  const ini = p.ini ?? p.iat;
  if (t - p.iat < RENOVAR_APOS_SEG) return;
  if (t - ini > VIDA_MAXIMA_SEG) return;
  gravarCookieSessao(reply, criarToken(parseInt(p.sub, 10), p.nome, p.is_admin, ini));
}

// ── Limite de tentativas de login ────────────────────────────────────────────
//
// Contado por e-mail, não por IP: atrás do proxy da Vercel todo pedido chega
// com o IP da Vercel, e limitar por IP bloquearia todo mundo junto.
// Em memória: reiniciar o servidor zera a contagem, o que é aceitável aqui.

const MAX_FALHAS = 5;
const JANELA_MS  = 15 * 60 * 1000;

const falhas = new Map<string, { qtd: number; desde: number }>();

function chave(email: string): string {
  return email.trim().toLowerCase();
}

/** Segundos até liberar, ou 0 se pode tentar. */
export function loginBloqueado(email: string): number {
  const f = falhas.get(chave(email));
  if (!f) return 0;
  const passou = Date.now() - f.desde;
  if (passou > JANELA_MS) { falhas.delete(chave(email)); return 0; }
  return f.qtd >= MAX_FALHAS ? Math.ceil((JANELA_MS - passou) / 1000) : 0;
}

export function registrarFalhaLogin(email: string): void {
  const k = chave(email);
  const f = falhas.get(k);
  if (!f || Date.now() - f.desde > JANELA_MS) falhas.set(k, { qtd: 1, desde: Date.now() });
  else f.qtd += 1;
}

export function limparFalhasLogin(email: string): void {
  falhas.delete(chave(email));
}

// ── state do OAuth do Google ─────────────────────────────────────────────────
//
// Antes o state era só o id do gestor em base64: qualquer um podia montar um
// state com o id de outra pessoa e ligar a própria conta Google à agenda dela.
// Agora vai assinado e vale 10 minutos.

export function criarStateGoogle(gestorId: number): string {
  return jwt.sign({ sub: String(gestorId), uso: 'google-oauth' }, JWT_SECRET, { expiresIn: '10m' });
}

export function lerStateGoogle(state: string): number | null {
  try {
    const p = jwt.verify(state, JWT_SECRET) as { sub: string; uso?: string };
    if (p.uso !== 'google-oauth') return null;
    const id = parseInt(p.sub, 10);
    return Number.isFinite(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}
