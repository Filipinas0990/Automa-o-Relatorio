/**
 * Carregador de variáveis de ambiente — ÚNICO ponto de entrada.
 *
 * Existe UM só `.env`, na raiz do projeto (ao lado do docker-compose.yml).
 * Importe este módulo (`import './env'`) no lugar de `dotenv/config`, para que
 * o arquivo certo seja encontrado independente de onde o processo foi iniciado.
 *
 * No Docker as variáveis já chegam pelo `env_file` do compose (process.env),
 * então nenhum arquivo é necessário — o carregamento simplesmente não acha nada
 * e segue em frente. O dotenv nunca sobrescreve variáveis já definidas.
 */
import { config } from 'dotenv';
import { existsSync } from 'fs';
import { resolve } from 'path';

// __dirname é .../pharmaflow-node/src (ts-node) ou .../pharmaflow-node/dist (build).
// Nos dois casos, a raiz do projeto fica dois níveis acima.
const CAMINHOS = [
  resolve(__dirname, '../../.env'),      // raiz do projeto (caso normal)
  resolve(process.cwd(), '../.env'),     // rodando de dentro de pharmaflow-node/
  resolve(process.cwd(), '.env'),        // rodando da raiz
];

const encontrado = CAMINHOS.find((p) => existsSync(p));
if (encontrado) config({ path: encontrado });

export const ENV_CARREGADO_DE = encontrado ?? '(nenhum arquivo — usando process.env)';
