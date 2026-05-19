import pino from 'pino';
import { mkdirSync } from 'fs';

const LOG_DIR = '/app/logs';

try { mkdirSync(LOG_DIR, { recursive: true }); } catch { /* ok */ }

const transport = pino.transport({
  targets: [
    {
      target: 'pino-pretty',
      level: process.env.LOG_LEVEL || 'info',
      options: {
        colorize: true,
        translateTime: 'yyyy-mm-dd HH:MM:ss',
        ignore: 'pid,hostname',
        messageFormat: '{msg}',
        singleLine: false,
      },
    },
    {
      target: 'pino/file',
      level: 'info',
      options: {
        destination: `${LOG_DIR}/pharmaflow.log`,
        mkdir: true,
      },
    },
  ],
});

export const logger = pino(
  { level: process.env.LOG_LEVEL || 'info' },
  transport
);
