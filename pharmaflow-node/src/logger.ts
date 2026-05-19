import pino from 'pino';
import { mkdirSync } from 'fs';

const LOG_DIR = '/app/logs';

try { mkdirSync(LOG_DIR, { recursive: true }); } catch { /* ok se não existir ainda */ }

export const logger = pino(
  {
    level: process.env.LOG_LEVEL || 'info',
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level:    (label) => ({ level: label }),
      bindings: ()      => ({}),            // remove pid/hostname do JSON
    },
  },
  pino.multistream([
    { stream: process.stdout },
    { stream: pino.destination(`${LOG_DIR}/pharmaflow.log`) },
  ])
);
