/**
 * Raiz de composição: o único lugar que cria as classes e liga uma à outra.
 *
 * Cada classe recebe o que usa pelo construtor e não sabe de onde veio.
 * Para trocar uma peça (ex.: um repository falso num teste), troca-se aqui.
 */
import './env';
import { db } from './database/db';
import { HashSenha } from './compartilhado/HashSenha';
import { TokenSessao, lerSegredoJwt } from './auth/TokenSessao';
import { TransporteSessao } from './auth/TransporteSessao';
import { LimitadorLogin } from './auth/LimitadorLogin';
import { StateOAuth } from './auth/StateOAuth';
import { Autenticador } from './auth/Autenticador';
import { AuthService } from './auth/AuthService';
import { AuthController } from './auth/AuthController';
import { GestorRepository } from './gestores/GestorRepository';
import { GestorService } from './gestores/GestorService';
import { GestorController } from './gestores/GestorController';

const segredoJwt = lerSegredoJwt();
const hashSenha  = new HashSenha();

// ── Sessão ────────────────────────────────────────────────────────────────────
export const tokenSessao      = new TokenSessao(segredoJwt);
export const transporteSessao = new TransporteSessao();
export const stateGoogle      = new StateOAuth(segredoJwt, 'google-oauth');
export const stateMeta        = new StateOAuth(segredoJwt, 'meta-oauth');

// ── Gestores ──────────────────────────────────────────────────────────────────
export const gestorRepository = new GestorRepository(db);
export const autenticador     = new Autenticador(tokenSessao, transporteSessao, gestorRepository);
export const gestorController = new GestorController(new GestorService(gestorRepository, hashSenha), autenticador);

// ── Auth ──────────────────────────────────────────────────────────────────────
const authService = new AuthService(
  gestorRepository, hashSenha, new LimitadorLogin(), process.env.ADMIN_SECRET || '',
);
export const authController = new AuthController(authService, autenticador, tokenSessao, transporteSessao);
