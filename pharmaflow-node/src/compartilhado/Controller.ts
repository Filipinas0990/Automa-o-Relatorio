import type { FastifyInstance } from 'fastify';
import { ErroAplicacao } from './erros';

/**
 * Base dos controllers: cada um declara suas rotas em `rotas()` e é
 * registrado como plugin (`app.register(controller.plugin)`).
 *
 * O plugin é encapsulado, então o tratador de erro abaixo vale só para as
 * rotas deste controller. Erro que não é de negócio sobe para o tratador
 * padrão do Fastify, como antes.
 */
export abstract class Controller {
  protected abstract rotas(app: FastifyInstance): void;

  readonly plugin = async (app: FastifyInstance): Promise<void> => {
    app.setErrorHandler((erro, _request, reply) => {
      if (!(erro instanceof ErroAplicacao)) throw erro;
      return reply.code(erro.status).headers(erro.cabecalhos).send({ detail: erro.detail });
    });
    this.rotas(app);
  };
}
