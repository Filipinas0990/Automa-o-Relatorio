import { defineConfig } from 'vitest/config';

const TEST_DB = process.env.TEST_DB_NAME || 'farmacia_monitor_test';

export default defineConfig({
  test: {
    globalSetup: ['./test/prepararBanco.ts'],
    // Um arquivo por vez: os testes compartilham o mesmo banco e limpam tabelas
    // entre si, então rodar em paralelo daria resultado instável.
    fileParallelism: false,
    testTimeout: 20_000,
    include: ['test/**/*.test.ts'],
    env: {
      // Precisa estar definido ANTES de src/database/db.ts ser importado —
      // é lá que a conexão é criada, na carga do módulo.
      DATABASE_URL: process.env.TEST_DATABASE_URL
        || `postgresql://farmacia:farmacia123@localhost:5432/${TEST_DB}`,
      JWT_SECRET_KEY: 'segredo-de-teste-com-pelo-menos-32-caracteres',
      NODE_ENV: 'test',
      // Sem isso o log de cada request afoga o resultado da suíte
      LOG_LEVEL: 'silent',
      // Em produção há 1,5s entre mensagens; no teste isso só faria a suíte arrastar
      DISPARO_DELAY_MS: '0',
      // A Evolution é sempre simulada nos testes — nenhuma mensagem real sai.
      // Porta fechada em loopback: recusa a conexão na hora. Um domínio
      // inexistente faria cada chamada esperar o DNS estourar (suíte ~5x mais lenta).
      EVOLUTION_API_URL: 'http://127.0.0.1:1',
      EVOLUTION_API_KEY: 'chave-de-teste',
      FRONTEND_URL: 'http://localhost:5173',
    },
  },
});
