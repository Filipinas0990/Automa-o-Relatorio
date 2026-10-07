import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Gestor } from '../database/schema';
import type { GestorRepository } from '../gestores/GestorRepository';
import type { TokenSessao } from './TokenSessao';
import type { TransporteSessao } from './TransporteSessao';

// Adiciona `user` ao FastifyRequest — preenchido por `autenticar`
declare module 'fastify' {
  interface FastifyRequest {
    user: Gestor;
  }
}

export type Middleware = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

/**
 * preHandlers de acesso às rotas. São propriedades (não métodos) para poderem
 * ser passados soltos: `{ preHandler: auth.autenticar }`.
 */
export class Autenticador {
  constructor(
    private readonly tokens: TokenSessao,
    private readonly transporte: TransporteSessao,
    private readonly gestores: GestorRepository,
  ) {}

  readonly autenticar: Middleware = async (request, reply) => {
    const credencial = this.transporte.lerDoPedido(request);
    if (!credencial) { reply.code(401).send({ detail: 'Token não fornecido' }); return; }
    try {
      const payload = this.tokens.verificar(credencial.token);
      const gestor = await this.gestores.buscarAtivoPorId(parseInt(payload.sub, 10));
      if (!gestor) { reply.code(401).send({ detail: 'Usuário não encontrado' }); return; }
      request.user = gestor;

      if (credencial.origem === 'cookie') {
        const renovado = this.tokens.renovar(payload);
        if (renovado) this.transporte.gravar(reply, renovado);
      }
    } catch {
      reply.code(401).send({ detail: 'Token inválido ou expirado' });
    }
  };

  readonly apenasAdmin: Middleware = async (request, reply) => {
    if (!request.user?.isAdmin) {
      reply.code(403).send({ detail: 'Acesso restrito ao administrador' });
    }
  };
}
