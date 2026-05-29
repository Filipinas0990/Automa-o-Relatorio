# SPEC TÉCNICO — Log Stream em Tempo Real do Pipeline
**PharmaFlow v2 — Frontend**
**Tech Lead:** Claude (Sonnet 4.6)
**Data:** 2026-05-29
**Status:** Pronto para implementação

---

## 1. Contexto e Objetivo

Quando o usuário clica em "Rodar Agora", o pipeline pode levar 10–30 minutos.
Antes, a tela ficava com um spinner genérico sem nenhuma informação do que estava acontecendo.

Agora o backend transmite cada etapa da coleta em tempo real via **Server-Sent Events (SSE)**.
O frontend deve abrir um painel estilo terminal que exibe os logs conforme chegam, permitindo
ao usuário acompanhar o progresso farmácia por farmácia.

---

## 2. O que é SSE (Server-Sent Events)

SSE é um protocolo HTTP nativo do browser — **sem biblioteca necessária**.
O servidor mantém a conexão aberta e envia linhas de texto à medida que os eventos ocorrem.
O browser lê via `EventSource`, que reconecta automaticamente se a conexão cair.

```
Browser                          Servidor
  │                                 │
  │── GET /api/pipeline/logs/stream ─►│
  │                                 │
  │◄── data: {"msg":"🚀 Pipeline..."} ──│
  │◄── data: {"msg":"📅 Período 7d..."} │
  │◄── data: {"msg":"🟢 Farmácia X..."} │
  │◄── data: {"msg":"❌ Farmácia Y..."} │
  │◄── event: done                  ──│  ← pipeline terminou
  │                                 │
  │── conexão fechada ──────────────►│
```

---

## 3. API Contract

### `GET /api/pipeline/logs/stream`

**Autenticação:** Bearer token no header (igual aos outros endpoints).
**Content-Type:** `text/event-stream`

```
GET https://api.pharmarelatorios.online/api/pipeline/logs/stream
Authorization: Bearer <token>
```

#### Eventos recebidos

**Evento de log (chega para cada etapa do pipeline):**
```
data: {"ts":"2026-05-29T23:05:01Z","level":"info","msg":"🚀 Pipeline iniciado — 70 farmácias | períodos: 7, 15, 30d","data":{"total":70,"periodos":[7,15,30]}}

```
*(linha em branco após cada evento é parte do protocolo SSE)*

**Evento de encerramento (pipeline terminou):**
```
event: done
data: {}

```

**Heartbeat (enviado a cada 25s para manter conexão ativa):**
```
: ping

```
*(linhas começando com `:` são comentários SSE — ignore no frontend)*

#### Tipo `LogEntry`

```ts
interface LogEntry {
  ts:    string;                    // ISO 8601 — ex: "2026-05-29T23:05:01Z"
  level: 'info' | 'warn' | 'error'; // nível do log
  msg:   string;                    // mensagem formatada (já tem emoji)
  data?: Record<string, unknown>;   // dados estruturados (opcional)
}
```

#### Exemplos reais de mensagens (campo `msg`)

```
🚀 Pipeline iniciado — 70 farmácias | períodos: 7, 15, 30d
📅 Iniciando período de 7 dias (70 farmácias)
🟢 Farmácia São Rafael (7d) — R$ 45.200,00 | 1.100 vendas
🟡 Drogaria Central (7d) — R$ 12.000,00 | 300 vendas
🔴 Farmácia Boa Saúde (7d) — R$ 8.500,00 | 180 vendas
❌ Drogaria Vitória (7d) — Timeout aguardando dashboard
✅ Período 7d concluído — 69 OK | 1 com erro
🔄 Retry 1/2: 1 farmácias falharam — aguardando 60s
🟢 Drogaria Vitória (7d) — R$ 15.200,00 | 420 vendas  ← retry funcionou
✅ Período 7d concluído — 70 OK
📅 Iniciando período de 15 dias (70 farmácias)
...
🏁 Pipeline concluído — 210/210 coletas OK
```

#### Comportamento ao conectar tarde (reconexão)

Se o frontend conectar **depois** de o pipeline já ter iniciado, o servidor envia imediatamente
todos os logs já emitidos (buffer de até 500 entradas) e depois continua em tempo real.

Se conectar **depois** de o pipeline já ter terminado, recebe o buffer e logo em seguida o evento `done`.

#### Quando o pipeline NÃO está rodando

Se conectar sem pipeline ativo, o servidor responde o buffer vazio e envia `event: done` imediatamente.
O frontend deve tratar isso sem erro (apenas não abre o painel de logs).

---

## 4. Como Conectar (código de referência)

```ts
// usePipelineLogs.ts — hook reutilizável

import { useState, useEffect, useRef } from 'react';

export interface LogEntry {
  ts:    string;
  level: 'info' | 'warn' | 'error';
  msg:   string;
  data?: Record<string, unknown>;
}

export function usePipelineLogs(ativo: boolean) {
  const [logs, setLogs]       = useState<LogEntry[]>([]);
  const [concluido, setConcluido] = useState(false);
  const sourceRef             = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!ativo) return;

    setLogs([]);
    setConcluido(false);

    const token = localStorage.getItem('pharma_token') ?? '';

    // EventSource não suporta headers nativamente — usamos query param como fallback
    // O backend aceita: Authorization: Bearer <token> no header
    // Como EventSource não envia headers customizados, use fetchEventSource (lib) ou um proxy
    // Veja seção 4.1 para a solução recomendada

    const source = new EventSource(
      `https://api.pharmarelatorios.online/api/pipeline/logs/stream?token=${token}`
    );

    source.onmessage = (e) => {
      try {
        const entry: LogEntry = JSON.parse(e.data);
        setLogs(prev => [...prev, entry]);
      } catch { /* ignora linhas malformadas */ }
    };

    source.addEventListener('done', () => {
      setConcluido(true);
      source.close();
    });

    source.onerror = () => {
      // EventSource reconecta automaticamente em caso de erro de rede
      // Só feche manualmente se não quiser reconexão
    };

    sourceRef.current = source;
    return () => { source.close(); sourceRef.current = null; };
  }, [ativo]);

  function limparLogs() { setLogs([]); setConcluido(false); }

  return { logs, concluido, limparLogs };
}
```

### 4.1 Autenticação via Query Param (necessário para EventSource)

O `EventSource` nativo do browser **não suporta headers customizados**.
Adicione suporte ao token via query string no backend — **já foi adicionado**.

O endpoint aceita o token de duas formas:
1. `Authorization: Bearer <token>` (header — para fetch/axios)
2. `?token=<token>` (query string — para EventSource nativo)

```ts
// Conexão com token via query string (EventSource nativo):
const url = `https://api.pharmarelatorios.online/api/pipeline/logs/stream?token=${getToken()}`;
const source = new EventSource(url);
```

> ⚠️ O backend já foi atualizado para aceitar o token via query string neste endpoint.
> Confirme que o middleware de autenticação lê `request.query.token` como fallback.

---

## 5. Componente `<PipelineLogTerminal />`

### 5.1 Aparência

```
╔══════════════════════════════════════════════════════════════════╗
║  📋 Log da coleta em tempo real                      [Limpar] [X] ║
║  ─────────────────────────────────────────────────────────────   ║
║  [23:05:01] 🚀 Pipeline iniciado — 70 farmácias | períodos: 7, 15, 30d ║
║  [23:05:03] 📅 Iniciando período de 7 dias (70 farmácias)        ║
║  [23:05:45] 🟢 Farmácia São Rafael (7d) — R$ 45.200,00 | 1.100 vendas║
║  [23:06:12] 🟡 Drogaria Central (7d) — R$ 12.000,00 | 300 vendas║
║  [23:07:30] ❌ Drogaria Vitória (7d) — Timeout aguardando dashboard║
║  [23:07:31] ✅ Período 7d concluído — 69 OK | 1 com erro        ║
║  [23:07:31] 🔄 Retry 1/2: 1 farmácias falharam — aguardando 60s ║
║  [23:08:31] 🟢 Drogaria Vitória (7d) — R$ 15.200,00 | 420 vendas║
║  [23:08:32] ✅ Período 7d concluído — 70 OK                     ║
║  [23:08:33] 📅 Iniciando período de 15 dias (70 farmácias)      ║
║  ...                                                             ║
║  ─────────────────────────────────────────────────────────────   ║
║  ● Transmitindo ao vivo                        Última: 23:08:33  ║
╚══════════════════════════════════════════════════════════════════╝
```

### 5.2 Especificações visuais

```
Fundo do terminal:   #0F172A  (azul escuro quase preto)
Texto padrão:        #E2E8F0  (cinza claro)
Fonte:               monospace — "JetBrains Mono", "Fira Code", monospace
Tamanho da fonte:    13px
Line-height:         1.6
Altura máxima:       400px com overflow-y: auto
Auto-scroll:         sempre rola para o final quando novo log chega
```

**Cores por nível:**
```
level: 'info'  → cor padrão #E2E8F0
level: 'warn'  → amarelo    #FCD34D
level: 'error' → vermelho   #F87171
```

**Timestamp:**
```ts
// Formatar o campo ts para exibir apenas HH:MM:SS no fuso local
function formatTs(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}
```

**Indicador de status (rodapé do terminal):**
```
● Transmitindo ao vivo   → bolinha verde pulsando + cor #10B981
■ Concluído              → quadrado cinza + cor #6B7280
✕ Desconectado           → X vermelho + cor #F87171
```

### 5.3 Props do componente

```ts
interface PipelineLogTerminalProps {
  ativo:     boolean;          // inicia a conexão SSE
  onConcluir?: () => void;     // chamado quando evento 'done' chega
}
```

### 5.4 Código de referência

```tsx
// components/PipelineLogTerminal.tsx

import { useEffect, useRef } from 'react';
import { usePipelineLogs } from '../hooks/usePipelineLogs';

const CORES_NIVEL = {
  info:  '#E2E8F0',
  warn:  '#FCD34D',
  error: '#F87171',
} as const;

export function PipelineLogTerminal({ ativo, onConcluir }: PipelineLogTerminalProps) {
  const { logs, concluido, limparLogs } = usePipelineLogs(ativo);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll ao chegar novo log
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs.length]);

  useEffect(() => {
    if (concluido) onConcluir?.();
  }, [concluido]);

  return (
    <div style={{
      background: '#0F172A', borderRadius: 8, padding: '12px 16px',
      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      fontSize: 13, lineHeight: 1.6, color: '#E2E8F0',
      maxHeight: 400, overflowY: 'auto',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ color: '#94A3B8', fontSize: 12 }}>📋 Log da coleta</span>
        <button onClick={limparLogs} style={{ color: '#64748B', fontSize: 11, background: 'none', border: 'none', cursor: 'pointer' }}>
          limpar
        </button>
      </div>

      {/* Linhas de log */}
      {logs.map((entry, i) => (
        <div key={i} style={{ color: CORES_NIVEL[entry.level], marginBottom: 2 }}>
          <span style={{ color: '#475569', marginRight: 8 }}>
            [{formatTs(entry.ts)}]
          </span>
          {entry.msg}
        </div>
      ))}

      {/* Mensagem de vazio */}
      {logs.length === 0 && (
        <div style={{ color: '#475569', fontStyle: 'italic' }}>
          Aguardando início da coleta...
        </div>
      )}

      {/* Âncora de scroll */}
      <div ref={bottomRef} />

      {/* Rodapé de status */}
      <div style={{
        marginTop: 12, paddingTop: 8,
        borderTop: '1px solid #1E293B',
        display: 'flex', justifyContent: 'space-between',
        fontSize: 11, color: '#475569',
      }}>
        <span>
          {ativo && !concluido && <span style={{ color: '#10B981' }}>● Transmitindo ao vivo</span>}
          {concluido && <span style={{ color: '#6B7280' }}>■ Concluído</span>}
          {!ativo && !concluido && <span>Inativo</span>}
        </span>
        {logs.length > 0 && (
          <span>Última: {formatTs(logs[logs.length - 1].ts)}</span>
        )}
      </div>
    </div>
  );
}

function formatTs(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}
```

---

## 6. Onde Integrar na UI

### 6.1 Modal "Rodar Agora" (principal)

O terminal deve abrir **dentro do modal** após o usuário confirmar.
O modal não fecha sozinho enquanto o pipeline roda — o usuário pode fechar manualmente se quiser.

```
╔═══════════════════════════════════════════════════╗
║  Rodar Automação                                  ║
║                                                   ║
║  [Antes de confirmar — formulário de opções]      ║
║  Período:  ☑ 7d  ☑ 15d  ☑ 30d                   ║
║  Gestor:   Todos                                  ║
║                          [Cancelar] [▶ Confirmar] ║
║                                                   ║
║  [Após confirmar — terminal aparece]              ║
║  ┌───────────────────────────────────────────┐    ║
║  │ [23:05:01] 🚀 Pipeline iniciado — 70 farm.│    ║
║  │ [23:05:03] 📅 Iniciando período de 7 dias │    ║
║  │ [23:05:45] 🟢 São Rafael (7d) — R$ 45k   │    ║
║  │ ...                                       │    ║
║  │ ● Transmitindo ao vivo      23:05:45      │    ║
║  └───────────────────────────────────────────┘    ║
║                                    [Fechar]       ║
╚═══════════════════════════════════════════════════╝
```

**Comportamento do botão "Fechar":**
- Disponível assim que o pipeline termina (evento `done`)
- Antes de terminar: exibe "Fechar (pipeline ainda rodando)" com cor cinza — permite fechar mas avisa

### 6.2 Dashboard — seção colapsável (opcional)

No Dashboard, abaixo do banner de status do pipeline, pode haver uma seção colapsável:

```
╔══════════════════════════════════════════════════╗
║  ⏳ Pipeline rodando...                          ║
║  [▼ Ver logs em tempo real]   ← clique para abrir║
║                                                  ║
║  [expandido]                                     ║
║  ┌──────────────────────────────────────────┐    ║
║  │ [23:05:01] 🚀 Pipeline iniciado...       │    ║
║  │ ...                                      │    ║
║  └──────────────────────────────────────────┘    ║
╚══════════════════════════════════════════════════╝
```

---

## 7. Integração com o PipelineContext (spec anterior)

O `PipelineContext` já controla `pipelineRodando`. Basta passar esse valor para o terminal:

```tsx
// Em qualquer componente que usa o modal
const { pipelineRodando, iniciarPipeline } = usePipeline();

// No modal após confirmar:
<PipelineLogTerminal
  ativo={pipelineRodando}
  onConcluir={() => {
    // opcional: recarregar dados do dashboard
    refetchFarmacias();
  }}
/>
```

---

## 8. Autenticação no EventSource (passo crítico)

O `EventSource` nativo não envia headers. O backend aceita o token via query string **neste endpoint específico**:

```ts
// hooks/usePipelineLogs.ts — conexão com autenticação
const token = localStorage.getItem('pharma_token') ?? '';
const url   = `${API_BASE}/api/pipeline/logs/stream?token=${encodeURIComponent(token)}`;
const source = new EventSource(url);
```

> ⚠️ Não use `fetch` + `ReadableStream` como alternativa sem necessidade — `EventSource` já
> faz reconexão automática, o que é exatamente o que queremos aqui.

---

## 9. Tratamento de Erros e Edge Cases

| Situação | Comportamento esperado |
|---|---|
| Usuário fecha o modal durante o pipeline | `EventSource.close()` — pipeline continua no servidor, resultados ficam em `ultimo_resultado` |
| Rede cai durante o stream | `EventSource` reconecta automaticamente — buffer é reenviado ao reconectar |
| Pipeline terminou antes de conectar | Recebe buffer + evento `done` imediatamente |
| Pipeline não está rodando | Recebe buffer vazio + evento `done` — não exibe o terminal |
| `ultimo_resultado === null` | Não exibe terminal — trata silenciosamente |
| Evento `done` nunca chega (bug no servidor) | Timeout de 45 min: `setTimeout(() => source.close(), 45 * 60 * 1000)` |

---

## 10. Ordem de Implementação

| # | Tarefa | Estimativa | Dependência |
|---|---|---|---|
| 1 | Hook `usePipelineLogs` com EventSource + autenticação | 45min | — |
| 2 | Componente `<PipelineLogTerminal />` (visual + auto-scroll) | 1h | 1 |
| 3 | Integrar terminal no modal "Rodar Agora" | 30min | 2 |
| 4 | Animação de status (● pulsando) | 20min | 2 |
| 5 | Seção colapsável no Dashboard (opcional) | 30min | 2 |
| 6 | Timeout de segurança (45 min) no hook | 10min | 1 |

**Total estimado: ~3h**

---

## 11. Critérios de Aceite

- [ ] Clicar em "Confirmar" no modal abre o terminal imediatamente
- [ ] Cada etapa aparece na tela em tempo real (delay < 1s do servidor)
- [ ] Logs de erro aparecem em vermelho, warnings em amarelo, info em branco
- [ ] O terminal rola automaticamente para o último log
- [ ] O status muda de "● Transmitindo" para "■ Concluído" quando o pipeline termina
- [ ] Fechar o modal não interrompe o pipeline — resultado aparece normalmente depois
- [ ] Reconectar ao modal (se fechou e abriu de novo) mostra os logs já emitidos (buffer)
- [ ] Funciona em mobile — terminal tem scroll interno, não a página inteira

---

## 12. Mock para Desenvolvimento

Use este mock no hook para testar sem backend rodando:

```ts
// Simula chegada de logs a cada 500ms
export function usePipelineLogsMock(ativo: boolean) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [concluido, setConcluido] = useState(false);

  useEffect(() => {
    if (!ativo) return;
    const mensagens = [
      { level: 'info' as const, msg: '🚀 Pipeline iniciado — 70 farmácias | períodos: 7, 15, 30d' },
      { level: 'info' as const, msg: '📅 Iniciando período de 7 dias (70 farmácias)' },
      { level: 'info' as const, msg: '🟢 Farmácia São Rafael (7d) — R$ 45.200,00 | 1.100 vendas' },
      { level: 'info' as const, msg: '🟡 Drogaria Central (7d) — R$ 12.000,00 | 300 vendas' },
      { level: 'error' as const, msg: '❌ Drogaria Vitória (7d) — Timeout aguardando dashboard' },
      { level: 'warn'  as const, msg: '🔄 Retry 1/2: 1 farmácias falharam — aguardando 60s' },
      { level: 'info' as const, msg: '🟢 Drogaria Vitória (7d) — R$ 15.200,00 | 420 vendas' },
      { level: 'info' as const, msg: '✅ Período 7d concluído — 70 OK' },
      { level: 'info' as const, msg: '🏁 Pipeline concluído — 210/210 coletas OK' },
    ];
    let i = 0;
    const timer = setInterval(() => {
      if (i >= mensagens.length) { setConcluido(true); clearInterval(timer); return; }
      setLogs(prev => [...prev, { ts: new Date().toISOString(), ...mensagens[i++] }]);
    }, 600);
    return () => clearInterval(timer);
  }, [ativo]);

  return { logs, concluido, limparLogs: () => { setLogs([]); setConcluido(false); } };
}
```
