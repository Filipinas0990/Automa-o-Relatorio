// Publicações em segundo plano.
//
// O front fala com a API por um proxy edge na Vercel, que derruba a requisição
// se a resposta não começar em ~25 s. Publicar no Meta passa disso com folga
// (4 anúncios + recriar o conjunto mediu 25 s em 01/10/2026): o Meta concluía,
// o gestor via "Erro no servidor" e tentava de novo — duplicando os anúncios.
//
// Então a publicação responde na hora com um id e roda aqui; o front consulta
// GET /api/campanhas/publicacoes/:id até terminar. Fica em memória: se o
// servidor reiniciar no meio, a consulta volta 404 e o front manda o gestor
// conferir no Gerenciador antes de tentar de novo.

import { randomUUID } from 'node:crypto';
import { logger } from '../logger';

export interface Resposta {
  codigo: number;
  corpo:  unknown;
}

interface Publicacao {
  status:   'rodando' | 'concluida';
  resposta: Resposta | null;
  criadaEm: number;
}

const publicacoes = new Map<string, Publicacao>();

/** Resultado fica 1 h disponível — o front consulta a cada poucos segundos. */
const VALIDADE_MS = 60 * 60 * 1000;

function limparAntigas(): void {
  const limite = Date.now() - VALIDADE_MS;
  for (const [id, p] of publicacoes) {
    if (p.criadaEm < limite) publicacoes.delete(id);
  }
}

const ID_VALIDO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Dispara `executar` sem esperar e devolve o id para consulta.
 *
 * `idDoCliente` vem do front: se a resposta deste POST se perder no proxy, o
 * front ainda sabe qual id consultar — e descobre se publicou ou não. Pelo
 * mesmo motivo é idempotente: o mesmo id chegando de novo NÃO publica outra
 * vez, só devolve a publicação que já existe.
 */
export function iniciarPublicacao(executar: () => Promise<Resposta>, idDoCliente?: string): string {
  limparAntigas();
  if (idDoCliente && publicacoes.has(idDoCliente)) return idDoCliente;
  const id = idDoCliente && ID_VALIDO.test(idDoCliente) ? idDoCliente : randomUUID();
  const pub: Publicacao = { status: 'rodando', resposta: null, criadaEm: Date.now() };
  publicacoes.set(id, pub);

  executar()
    .then((r) => { pub.resposta = r; })
    .catch((err) => {
      // `executar` já trata os erros do Meta; isto é só a rede de segurança.
      logger.error({ err: (err as Error).message, publicacao: id }, 'Publicação falhou sem tratamento');
      pub.resposta = { codigo: 500, corpo: { detail: 'Erro inesperado ao publicar.' } };
    })
    .finally(() => { pub.status = 'concluida'; });

  return id;
}

export function consultarPublicacao(id: string): Publicacao | undefined {
  return publicacoes.get(id);
}
