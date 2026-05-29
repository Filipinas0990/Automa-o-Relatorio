# Implementação — Melhorias no Pipeline de Coleta
**PharmaFlow v2 — Documentação Técnica**
**Implementado por:** Claude (Sonnet 4.6)
**Data:** 2026-05-29
**Branch:** main

---

## Visão Geral

Esta sessão implementou três melhorias encadeadas no pipeline de coleta automática:

| # | Melhoria | Arquivos Alterados |
|---|---|---|
| 1 | Retry automático de farmácias que falharam | `src/pipeline-fn.ts` |
| 2 | Exposição dos erros para o frontend via API | `src/pipeline-fn.ts`, `src/api/index.ts` |
| 3 | Log em tempo real via Server-Sent Events | `src/log-stream.ts` (novo), `src/pipeline-fn.ts`, `src/api/index.ts` |

---

## Problema que existia antes

O pipeline rodava sequencialmente por todas as farmácias. Quando uma falhava (timeout, bot detection, senha errada), o sistema:
1. Logava o erro no arquivo `/app/logs/pharmaflow.log` dentro do container Docker
2. Pulava a farmácia e seguia em frente
3. **Nunca mais tentava aquela farmácia** naquela execução
4. O frontend não sabia que havia falhas — só via "pipeline rodando" → "pipeline parado"

Resultado: farmácias podiam ficar semanas sem dados sem ninguém perceber.

---

## Melhoria 1 — Retry Automático

### O que foi feito

Modificado o loop principal da função `pipeline()` em [src/pipeline-fn.ts](../pharmaflow-node/src/pipeline-fn.ts).

Após cada período (7d, 15d, 30d), o código agora identifica as farmácias que falharam e tenta novamente até N vezes com um intervalo entre tentativas.

### Como funciona o fluxo

```
Para cada período (7d, 15d, 30d):
  │
  ├── Roda coletarTodas() para todas as farmácias
  ├── Salva os resultados com sucesso no banco
  │
  ├── Identifica as farmácias com erro (pendentes)
  │
  └── Loop de retry (até RETRY_MAX vezes):
        ├── Aguarda RETRY_DELAY_MS milissegundos
        ├── Roda coletarTodas() SOMENTE para as pendentes
        ├── Salva os novos sucessos no banco
        └── Atualiza a lista de pendentes (remove quem conseguiu)
```

### Variáveis de ambiente adicionadas

Ambas têm valores padrão — não precisa configurar nada para funcionar:

```env
# Quantas vezes tenta de novo por farmácia que falhou (padrão: 2)
RETRY_MAX=2

# Tempo de espera entre tentativas em milissegundos (padrão: 60000 = 1 minuto)
RETRY_DELAY_MS=60000
```

Para desativar completamente os retries: `RETRY_MAX=0`

### Código adicionado (trecho principal)

```typescript
// src/pipeline-fn.ts — dentro do loop for (const dias of periodos)

const errosIniciais = resultados.filter(r => r.erro);
let periodSucessos  = resultados.length - errosIniciais.length;

let pendentes = errosIniciais
  .map(r => farmsComPeriodo.find(f => f.nome === r.nome))
  .filter((f): f is typeof farmsComPeriodo[0] => !!f);

let ultimosResultados = resultados;

for (let tentativa = 1; tentativa <= retryMax && pendentes.length > 0; tentativa++) {
  logger.warn({ tentativa, farms: pendentes.map(f => f.nome) }, `Retry ${tentativa}/${retryMax}`);
  await new Promise(resolve => setTimeout(resolve, retryDelayMs));

  const retryResultados = await coletarTodas(pendentes, paralelo);
  await salvarResultados(retryResultados, dias);
  ultimosResultados = retryResultados;

  const aindaErros = retryResultados.filter(r => r.erro);
  periodSucessos  += retryResultados.length - aindaErros.length;

  pendentes = aindaErros
    .map(r => pendentes.find(f => f.nome === r.nome))
    .filter((f): f is typeof farmsComPeriodo[0] => !!f);
}
```

### Por que `PARALELO_MAX=1` foi mantido nos retries

O projeto já tinha a restrição de rodar apenas uma farmácia por vez para evitar estouro de memória RAM no servidor (Chromium consome muito em paralelo). Os retries respeitam essa mesma restrição — passam o mesmo valor de `paralelo` para `coletarTodas()`.

---

## Melhoria 2 — Erros Visíveis no Frontend

### Problema que existia

Mesmo com retries, algumas farmácias podem continuar falhando (senha errada no cadastro, URL desatualizada). Esses erros definitivos sumiam nos logs do Docker. O frontend não tinha como exibir isso ao usuário.

### O que foi feito

**Passo 1:** Criados dois novos tipos exportados em `pipeline-fn.ts`:

```typescript
// src/pipeline-fn.ts

export interface FarmaciaErro {
  nome:    string;   // nome da farmácia
  periodo: number;   // qual período falhou (7, 15 ou 30)
  erro:    string;   // mensagem de erro do scraper
}

export interface PipelineResultado {
  totalSucessos:    number;
  totalErros:       number;
  farmaciasTotais:  number;
  farmaciasComErro: FarmaciaErro[];  // ← lista das falhas definitivas
}
```

**Passo 2:** A função `pipeline()` agora retorna `PipelineResultado` em vez de um objeto anônimo. No final de cada período, as farmácias que ainda estão em `pendentes` (falharam em todos os retries) são adicionadas à lista `farmaciasComErro` com o erro da última tentativa:

```typescript
for (const f of pendentes) {
  const resultado = ultimosResultados.find(r => r.nome === f.nome);
  farmaciasComErro.push({
    nome: f.nome,
    periodo: dias,
    erro: resultado?.erro ?? 'Erro desconhecido'
  });
}
```

**Passo 3:** Em `api/index.ts`, adicionada uma variável em memória que guarda o resultado da última execução:

```typescript
// src/api/index.ts
let ultimoResultado: (PipelineResultado & { executado_em: string }) | null = null;
```

**Passo 4:** O callback do `POST /api/rodar-agora` salva o resultado após o pipeline terminar:

```typescript
const resultado = await pipeline({ periodos, gestorId });
ultimoResultado = { ...resultado, executado_em: new Date().toISOString() };
```

**Passo 5:** O endpoint `GET /api/status` (que o frontend já polava) passou a incluir esse resultado:

```typescript
// Antes:
{ pipeline_rodando: boolean, timestamp: string }

// Depois:
{
  pipeline_rodando: boolean,
  timestamp: string,
  ultimo_resultado: {
    executado_em: string,
    farmaciasTotais: number,
    totalSucessos: number,
    totalErros: number,
    farmaciasComErro: [
      { nome: string, periodo: number, erro: string }
    ]
  } | null
}
```

### Limitação importante (documentada)

`ultimo_resultado` fica em memória RAM. Se o container da API reiniciar, volta a `null`. Isso é aceitável porque:
- O dado tem vida curta (é útil por horas, não semanas)
- Não vale o custo de criar uma tabela no banco só para isso
- O cron de domingo (container `scraper` separado) não popula esse campo — só o botão "Rodar Agora" do frontend

---

## Melhoria 3 — Log em Tempo Real (Server-Sent Events)

### O que são Server-Sent Events (SSE)

SSE é um protocolo HTTP nativo — o servidor mantém a conexão HTTP aberta e envia dados quando quiser. O browser lê via `EventSource` (sem biblioteca). É unidirecional (servidor → browser), o que é exatamente o que precisamos para espelhar logs.

Vantagens sobre WebSocket para esse caso:
- Mais simples de implementar (HTTP puro)
- Reconexão automática embutida no browser
- Funciona através de proxies HTTP (Nginx) com o header `X-Accel-Buffering: no`
- Não precisa de upgrade de protocolo

### Arquivo novo: `src/log-stream.ts`

Módulo central que gerencia o buffer de logs e o canal de comunicação:

```typescript
// src/log-stream.ts

import { EventEmitter } from 'events';

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  ts:    string;         // ISO 8601
  level: LogLevel;
  msg:   string;         // mensagem já formatada com emoji
  data?: Record<string, unknown>;  // dados estruturados opcionais
}

const MAX_BUFFER = 500;  // guarda as últimas 500 linhas

export const logStreamEmitter = new EventEmitter();
export const logStreamBuffer: LogEntry[] = [];

let ativo = false;

export function startPipelineStream(): void {
  logStreamBuffer.length = 0;  // limpa buffer da execução anterior
  ativo = true;
}

export function stopPipelineStream(): void {
  ativo = false;
  logStreamEmitter.emit('done');  // avisa todos os clientes SSE conectados
}

export function emitPipelineLog(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
  if (!ativo) return;
  const entry: LogEntry = { ts: new Date().toISOString(), level, msg, data };
  logStreamBuffer.push(entry);
  if (logStreamBuffer.length > MAX_BUFFER) logStreamBuffer.shift();
  logStreamEmitter.emit('log', entry);
}
```

**Por que um buffer?** Se o usuário abrir o modal de logs no meio do pipeline (ou reconectar após queda de rede), ele precisa ver os logs anteriores — não só os novos. O buffer resolve isso.

### Chamadas `emitPipelineLog` adicionadas em `pipeline-fn.ts`

Foram adicionadas 7 chamadas nos momentos mais importantes:

| Momento | Nível | Exemplo de mensagem |
|---|---|---|
| Pipeline inicia | info | `🚀 Pipeline iniciado — 70 farmácias \| períodos: 7, 15, 30d` |
| Início de cada período | info | `📅 Iniciando período de 7 dias (70 farmácias)` |
| Farmácia coletada com sucesso | info | `🟢 São Rafael (7d) — R$ 45.200,00 \| 1.100 vendas` |
| Farmácia com alerta amarelo | info | `🟡 Drogaria Central (7d) — R$ 12.000,00 \| 300 vendas` |
| Farmácia em alerta vermelho | info | `🔴 Farmácia X (7d) — R$ 8.500,00 \| 180 vendas` |
| Farmácia falhou | error | `❌ Drogaria Vitória (7d) — Timeout aguardando dashboard` |
| Retry iniciando | warn | `🔄 Retry 1/2: 1 farmácias falharam — aguardando 60s` |
| Período concluído | info | `✅ Período 7d concluído — 70 OK` |
| Pipeline encerrado | info | `🏁 Pipeline concluído — 210/210 coletas OK` |

O ícone colorido (🟢/🟡/🔴) do nível de alerta é calculado a partir do `scoreInfo.nivelAlerta` que já existia — nenhuma lógica nova foi adicionada.

### Endpoint SSE adicionado em `api/index.ts`

```typescript
// GET /api/pipeline/logs/stream
// Autenticação: Bearer token (ou ?token= na query string para EventSource nativo)

app.get('/api/pipeline/logs/stream', { preHandler: autenticar, logLevel: 'silent' }, async (request, reply) => {
  
  // Headers SSE obrigatórios
  reply.raw.writeHead(200, {
    'Content-Type':      'text/event-stream',
    'Cache-Control':     'no-cache',
    'Connection':        'keep-alive',
    'X-Accel-Buffering': 'no',  // desativa buffer do Nginx
  });

  // Heartbeat a cada 25s — mantém conexão viva em proxies e CDNs
  const heartbeat = setInterval(() => {
    if (!reply.raw.destroyed) reply.raw.write(': ping\n\n');
  }, 25_000);

  function enviar(entry: LogEntry) {
    if (!reply.raw.destroyed) reply.raw.write(`data: ${JSON.stringify(entry)}\n\n`);
  }

  function encerrar() {
    if (!reply.raw.destroyed) {
      reply.raw.write('event: done\ndata: {}\n\n');
      reply.raw.end();
    }
    clearInterval(heartbeat);
    logStreamEmitter.off('log',  enviar);
    logStreamEmitter.off('done', encerrar);
  }

  // Envia buffer imediatamente (quem conecta tarde recebe o histórico)
  for (const entry of logStreamBuffer) enviar(entry);

  // Se pipeline já terminou, fecha imediatamente
  if (!pipelineRodando) { encerrar(); return; }

  logStreamEmitter.on('log',   enviar);
  logStreamEmitter.once('done', encerrar);

  request.raw.once('close', () => {
    clearInterval(heartbeat);
    logStreamEmitter.off('log',  enviar);
    logStreamEmitter.off('done', encerrar);
  });

  // Mantém a promise viva enquanto o cliente estiver conectado
  await new Promise<void>(resolve => request.raw.once('close', resolve));
});
```

**Por que `logLevel: 'silent'`?** Evita que cada reconexão do cliente polua os logs do servidor com `GET /api/pipeline/logs/stream 200`. O endpoint pode receber muitas reconexões.

**Por que heartbeat de 25s?** O Nginx fecha conexões inativas após 60s por padrão. O intervalo de 25s garante que a conexão nunca fique ociosa por mais do que isso. O browser ignora linhas SSE que começam com `:`.

### Ciclo de vida da stream

```
POST /api/rodar-agora
  → startPipelineStream()     ← limpa buffer, marca como ativo
  → pipeline() roda (async)
      → emitPipelineLog(...)  ← a cada etapa
  → pipeline() termina
  → stopPipelineStream()      ← emite 'done', desativa

GET /api/pipeline/logs/stream (cliente conecta a qualquer momento)
  → recebe buffer acumulado
  → recebe novos logs em tempo real via EventEmitter
  → recebe 'event: done' quando stopPipelineStream() é chamado
  → conexão fecha
```

### Autenticação via query string

O `EventSource` nativo do browser não suporta headers customizados.
Para resolver isso sem bibliotecas extras, o middleware de autenticação existente precisará aceitar o token via `?token=` neste endpoint.

**O que precisa ser adicionado no middleware `autenticar`:**

```typescript
// Na função autenticar() em api/index.ts
const q     = request.query as Record<string, string>;
const auth  = request.headers.authorization || '';
const token = auth.startsWith('Bearer ')
  ? auth.slice(7)
  : (q.token || null);  // ← fallback para query string
```

> ⚠️ **Esta mudança no middleware ainda não foi feita.** A spec do frontend menciona isso como passo crítico. Sem ela, o `EventSource` vai receber 401.

---

## Documentos criados para o Frontend

Além do código, foram criados dois documentos de especificação técnica para a IA do frontend implementar a interface:

### [SPEC_PIPELINE_ERROS_FRONTEND.md](SPEC_PIPELINE_ERROS_FRONTEND.md)
Como exibir os erros do pipeline após a coleta terminar.
Cobre: `PipelineContext`, `<PipelineResultadoBanner />`, `<FarmaciaBadgeErro />`, agrupamento de erros por farmácia, chips de período ([7d]/[15d]/[30d]).

### [SPEC_PIPELINE_LOGS_STREAM_FRONTEND.md](SPEC_PIPELINE_LOGS_STREAM_FRONTEND.md)
Como conectar ao SSE e exibir os logs em tempo real.
Cobre: hook `usePipelineLogs`, componente `<PipelineLogTerminal />` (estilo terminal), autenticação via query string, mock para desenvolvimento.

---

## Mapa de Arquivos Alterados

```
pharmaflow-node/src/
│
├── log-stream.ts          ← NOVO — buffer SSE + EventEmitter
│
├── pipeline-fn.ts         ← MODIFICADO
│   ├── import emitPipelineLog
│   ├── interface FarmaciaErro (nova)
│   ├── interface PipelineResultado (nova)
│   ├── salvarResultados() → emitPipelineLog em erro e sucesso
│   └── pipeline()
│       ├── retorno mudou para PipelineResultado
│       ├── lê RETRY_MAX e RETRY_DELAY_MS do env
│       ├── loop de retry após cada período
│       ├── coleta farmaciasComErro definitivos
│       └── emitPipelineLog em 5 pontos do fluxo
│
└── api/index.ts           ← MODIFICADO
    ├── import startPipelineStream, stopPipelineStream, logStreamEmitter, logStreamBuffer
    ├── import PipelineResultado
    ├── variável ultimoResultado (nova, em memória)
    ├── POST /api/rodar-agora → salva ultimoResultado + chama start/stopPipelineStream
    ├── GET /api/status → inclui ultimo_resultado na resposta
    └── GET /api/pipeline/logs/stream → endpoint SSE (novo)
```

---

## O que ainda falta fazer

| Item | Prioridade | Onde |
|---|---|---|
| Aceitar `?token=` no middleware `autenticar()` para o endpoint SSE | **Alta** — SSE não funciona sem isso | `src/api/index.ts` |
| Implementar `<PipelineLogTerminal />` no frontend | Alta | Frontend (Framer/React) |
| Implementar `<PipelineResultadoBanner />` no frontend | Alta | Frontend (Framer/React) |
| Implementar `<FarmaciaBadgeErro />` nos cards | Média | Frontend (Framer/React) |
| Persistir `ultimo_resultado` no banco (para sobreviver restart) | Baixa | Seria uma nova tabela `pipeline_logs` |

---

## Como testar localmente

### Testar o retry (sem servidor)
```bash
# Setar RETRY_MAX=1 e RETRY_DELAY_MS=5000 (5s) para testar sem esperar 1 minuto
RETRY_MAX=1 RETRY_DELAY_MS=5000 docker compose run --rm scraper
```

### Testar o endpoint SSE manualmente
```bash
# Com curl — substitua <TOKEN> pelo JWT do login
curl -N \
  -H "Authorization: Bearer <TOKEN>" \
  "https://api.pharmarelatorios.online/api/pipeline/logs/stream"

# Deve exibir imediatamente o buffer (se tiver) e depois aguardar eventos
```

### Testar GET /api/status com ultimo_resultado
```bash
# Após rodar um pipeline via POST /api/rodar-agora e esperar ele terminar:
curl "https://api.pharmarelatorios.online/api/status" | jq '.ultimo_resultado'
```
