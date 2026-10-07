/**
 * Erros de regra de negócio.
 *
 * O Service lança; o Controller (ver ./Controller.ts) transforma em resposta
 * HTTP `{ detail }` com o status do erro. Assim a regra não precisa conhecer
 * o `reply` do Fastify.
 */
export class ErroAplicacao extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
    readonly cabecalhos: Record<string, string> = {},
  ) {
    super(detail);
    this.name = new.target.name;
  }
}

export class RequisicaoInvalida extends ErroAplicacao {
  constructor(detail: string) { super(400, detail); }
}

export class NaoAutorizado extends ErroAplicacao {
  constructor(detail: string) { super(401, detail); }
}

export class Proibido extends ErroAplicacao {
  constructor(detail: string) { super(403, detail); }
}

export class NaoEncontrado extends ErroAplicacao {
  constructor(detail: string) { super(404, detail); }
}

export class Conflito extends ErroAplicacao {
  constructor(detail: string) { super(409, detail); }
}

export class MuitasTentativas extends ErroAplicacao {
  constructor(detail: string, esperaSeg: number) {
    super(429, detail, { 'Retry-After': String(esperaSeg) });
  }
}

export class Indisponivel extends ErroAplicacao {
  constructor(detail: string) { super(503, detail); }
}
