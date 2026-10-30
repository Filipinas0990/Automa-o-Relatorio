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
    /** Campos que vão na resposta junto do `detail`. */
    readonly extras: Record<string, unknown> = {},
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

/**
 * Um serviço externo (Evolution, Meta, Google...) falhou ou recusou. 502, e
 * não 500: o bug não é nosso, e não é 401/403 — não é a sessão do gestor que
 * está errada, então o frontend não deve deslogar ninguém por causa disto.
 */
export class FalhaExterna extends ErroAplicacao {
  constructor(detail: string) { super(502, detail); }
}
