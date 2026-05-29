import { EventEmitter } from 'events';

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  ts:    string;
  level: LogLevel;
  msg:   string;
  data?: Record<string, unknown>;
}

const MAX_BUFFER = 500;

export const logStreamEmitter = new EventEmitter();
export const logStreamBuffer: LogEntry[] = [];

let ativo = false;

/** Limpa o buffer e marca a stream como ativa (chamar antes de iniciar o pipeline) */
export function startPipelineStream(): void {
  logStreamBuffer.length = 0;
  ativo = true;
}

/** Marca a stream como inativa e emite evento de conclusão */
export function stopPipelineStream(): void {
  ativo = false;
  logStreamEmitter.emit('done');
}

/** Envia uma linha de log para todos os clientes SSE conectados */
export function emitPipelineLog(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
  if (!ativo) return;
  const entry: LogEntry = { ts: new Date().toISOString(), level, msg, data };
  logStreamBuffer.push(entry);
  if (logStreamBuffer.length > MAX_BUFFER) logStreamBuffer.shift();
  logStreamEmitter.emit('log', entry);
}
