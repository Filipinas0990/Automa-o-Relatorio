# SPEC TÉCNICO — Exibição de Erros do Pipeline
**PharmaFlow v2 — Frontend**
**Tech Lead:** Claude (Sonnet 4.6)
**Data:** 2026-05-29
**Status:** Pronto para implementação

---

## 1. Contexto e Objetivo

O backend passou a rastrear quais farmácias falharam durante a coleta automática (pipeline).
Antes, erros iam silenciosamente para o log do servidor — o frontend não tinha como saber.

Agora o endpoint `GET /api/status` retorna o resultado completo da última execução, incluindo:
- quantas farmácias foram coletadas com sucesso
- quais falharam (nome, período e mensagem de erro)
- quando a execução terminou

O objetivo é que o **usuário veja claramente quais farmácias precisam de atenção** após cada rodada do pipeline — sem precisar abrir o servidor para ler logs.

---

## 2. API Contract

### `GET /api/status`

Endpoint existente. **Não requer autenticação.** Retorna agora o campo `ultimo_resultado`.

```
GET https://api.pharmarelatorios.online/api/status
```

#### Resposta enquanto o pipeline está rodando
```json
{
  "pipeline_rodando": true,
  "timestamp": "2026-05-29T23:05:00Z",
  "ultimo_resultado": null
}
```

#### Resposta após o pipeline terminar (sem erros)
```json
{
  "pipeline_rodando": false,
  "timestamp": "2026-05-29T23:10:00Z",
  "ultimo_resultado": {
    "executado_em":    "2026-05-29T23:09:47Z",
    "farmaciasTotais": 70,
    "totalSucessos":   70,
    "totalErros":      0,
    "farmaciasComErro": []
  }
}
```

#### Resposta após o pipeline terminar (com erros)
```json
{
  "pipeline_rodando": false,
  "timestamp": "2026-05-29T23:10:00Z",
  "ultimo_resultado": {
    "executado_em":    "2026-05-29T23:09:47Z",
    "farmaciasTotais": 70,
    "totalSucessos":   67,
    "totalErros":      3,
    "farmaciasComErro": [
      { "nome": "Farmácia Boa Saúde", "periodo": 7,  "erro": "Timeout aguardando dashboard" },
      { "nome": "Farmácia Boa Saúde", "periodo": 15, "erro": "Timeout aguardando dashboard" },
      { "nome": "Drogaria Central",   "periodo": 30, "erro": "Login falhou após 3 tentativas" }
    ]
  }
}
```

#### Campos de `ultimo_resultado`

| Campo | Tipo | Descrição |
|---|---|---|
| `executado_em` | `string` (ISO 8601) | Quando o pipeline terminou |
| `farmaciasTotais` | `number` | Total de farmácias tentadas |
| `totalSucessos` | `number` | Farmácias coletadas com sucesso (após retries) |
| `totalErros` | `number` | Farmácias que falharam definitivamente |
| `farmaciasComErro` | `FarmaciaErro[]` | Lista detalhada de falhas |

#### Tipo `FarmaciaErro`

```ts
interface FarmaciaErro {
  nome:    string;   // nome da farmácia (igual ao cadastro)
  periodo: 7 | 15 | 30;  // qual período falhou
  erro:    string;   // mensagem de erro do scraper
}
```

> ⚠️ A mesma farmácia pode aparecer **várias vezes** se falhou em períodos diferentes.
> Ex: "Farmácia X" pode ter erro no período 7 e no período 15.

#### Limitação importante
`ultimo_resultado` é `null` quando:
- O servidor acabou de reiniciar (dado em memória, não persiste no banco)
- O pipeline **nunca** foi disparado pelo botão "Rodar Agora" da tela (o cron de domingo não salva aqui)

O frontend deve tratar `ultimo_resultado === null` sem erro.

---

## 3. Onde e Quando Exibir

### 3.1 Fluxo completo de estados

```
Usuário clica "Rodar Agora"
        │
        ▼
POST /api/rodar-agora   →  { status: 'iniciado' }
        │
        ▼
[polling GET /api/status a cada 5s]
        │
        ├── pipeline_rodando: true  →  exibe spinner/progress
        │
        └── pipeline_rodando: false
                │
                ├── totalErros === 0  →  toast de sucesso verde
                │
                └── totalErros > 0   →  banner de alerta com lista de erros
```

### 3.2 Telas que devem reações a esse estado

| Tela | Comportamento |
|---|---|
| **Dashboard / Painel** | Banner persistente no topo se `totalErros > 0` |
| **Modal "Rodar Agora"** | Resultado inline após o pipeline terminar |
| **Lista de Farmácias** | Badge de erro no card de cada farmácia afetada |

---

## 4. Componentes Novos

### 4.1 `<PipelineStatusPoller />` — Gerenciador de estado global

Componente invisível (sem UI própria) que roda o polling e guarda o estado no contexto.
Deve ser montado uma única vez, na raiz da aplicação (ex: dentro do layout logado).

**Lógica:**
```ts
// Inicia polling quando pipeline_rodando = true
// Para polling quando pipeline_rodando = false
// Intervalo: 5 segundos

useEffect(() => {
  let intervalo: NodeJS.Timeout;

  async function checar() {
    const res  = await fetch('/api/status');
    const data = await res.json();
    setPipelineStatus(data);
    if (!data.pipeline_rodando) clearInterval(intervalo);
  }

  if (pipelineRodando) {
    intervalo = setInterval(checar, 5000);
    checar(); // checa imediatamente
  }

  return () => clearInterval(intervalo);
}, [pipelineRodando]);
```

**Estado que expõe via Context:**
```ts
interface PipelineContextType {
  pipelineRodando:  boolean;
  ultimoResultado:  UltimoResultado | null;
  iniciarPipeline:  (periodos?: number[], gestorId?: number) => Promise<void>;
}

interface UltimoResultado {
  executado_em:    string;
  farmaciasTotais: number;
  totalSucessos:   number;
  totalErros:      number;
  farmaciasComErro: FarmaciaErro[];
}
```

---

### 4.2 `<PipelineProgressBar />` — Barra de progresso durante a coleta

Exibida no topo do Dashboard enquanto `pipelineRodando === true`.

```
╔══════════════════════════════════════════════════════════════╗
║  ⏳ Coletando dados das farmácias...                          ║
║  ████████████░░░░░░░░░░░░░░░  (animação indeterminada)       ║
║  Isso pode levar alguns minutos. Não feche a página.         ║
╚══════════════════════════════════════════════════════════════╝
```

- Cor: azul `#3B82F6`
- Barra: animação CSS `indeterminate` (não tem progresso real — backend não envia %)
- Substituída pelo `<PipelineResultadoBanner />` quando o pipeline terminar

---

### 4.3 `<PipelineResultadoBanner />` — Banner de resultado

Exibido no topo do Dashboard **após** o pipeline terminar.
Fecha ao clicar no X ou ao iniciar um novo pipeline.

#### Versão sucesso (totalErros === 0)
```
╔══════════════════════════════════════════════════════════════╗
║  ✅ Coleta concluída com sucesso                          [X] ║
║  70 farmácias coletadas · Executado em 23/05 às 23:09        ║
╚══════════════════════════════════════════════════════════════╝
```
- Cor de fundo: `rgba(16, 185, 129, 0.1)` (verde suave)
- Borda esquerda: `4px solid #10B981`

#### Versão com erros (totalErros > 0)
```
╔══════════════════════════════════════════════════════════════╗
║  ⚠️  Coleta concluída com 3 erros                        [X] ║
║  67 de 70 farmácias coletadas · Executado em 29/05 às 23:09  ║
║                                                              ║
║  Farmácias com falha (após 2 retries):                       ║
║  ┌──────────────────────────────────────────────────────┐    ║
║  │ • Farmácia Boa Saúde   [7d] [15d]  Timeout no login  │    ║
║  │ • Drogaria Central     [30d]       Login inválido     │    ║
║  └──────────────────────────────────────────────────────┘    ║
║                                                              ║
║  [Tentar novamente essas farmácias]  [Ver detalhes]          ║
╚══════════════════════════════════════════════════════════════╝
```
- Cor de fundo: `rgba(245, 158, 11, 0.1)` (âmbar suave)
- Borda esquerda: `4px solid #F59E0B`
- Ícone: ⚠️

**Como agrupar os erros para exibir:**
```ts
// farmaciasComErro pode ter a mesma farmácia várias vezes (um por período)
// Agrupar por nome para exibir em uma linha só

type FarmaciaAgrupada = {
  nome:     string;
  periodos: number[];   // ex: [7, 15]
  erro:     string;     // mensagem do último erro (todos costumam ser iguais)
};

function agruparErros(erros: FarmaciaErro[]): FarmaciaAgrupada[] {
  const mapa: Record<string, FarmaciaAgrupada> = {};
  for (const e of erros) {
    if (!mapa[e.nome]) mapa[e.nome] = { nome: e.nome, periodos: [], erro: e.erro };
    mapa[e.nome].periodos.push(e.periodo);
  }
  return Object.values(mapa);
}
```

**Chips de período:**
```
[7d]   → fundo azul   #3B82F6  (mesma paleta do seletor multi-período)
[15d]  → fundo roxo   #8B5CF6
[30d]  → fundo verde  #10B981
```

**Botão "Tentar novamente essas farmácias":**
- Chama `POST /api/rodar-agora` **sem filtros** (não há filtro por farmácia individual — o backend re-tenta todas)
- Ou: exibe um tooltip explicando "Clique em Rodar Agora para repetir toda a coleta"
- Ação real: `iniciarPipeline()` do Context

---

### 4.4 `<FarmaciaBadgeErro />` — Badge no card de farmácia

Pequeno indicador exibido no card de cada farmácia que está em `farmaciasComErro`.

```
╔═══════════════════════════════╗
║  Farmácia Boa Saúde           ║
║  ┌──────────────────┐         ║
║  │ ⚠️ Sem dados 7d  │         ║
║  └──────────────────┘         ║
║  Receita: — · Vendas: —       ║
╚═══════════════════════════════╝
```

**Lógica de exibição:**
```ts
// Na lista de farmácias, após pipeline terminar:
const errosDaFarmacia = ultimoResultado?.farmaciasComErro
  .filter(e => e.nome === farmacia.nome) ?? [];

// Se errosDaFarmacia.length > 0 → exibe badge
// Um badge por período que falhou
```

**Comportamento:**
- Tooltip ao hover: mostra a mensagem de erro completa
- Cor: âmbar `#F59E0B`
- Não substitui os dados antigos — a farmácia ainda exibe a última coleta bem-sucedida

---

## 5. Alterações em Componentes Existentes

### 5.1 Modal "Rodar Agora" (existente)

**Antes:** Fecha ao clicar em "Confirmar" e mostra um toast simples.

**Depois — adicionar seção de resultado:**
```
╔════════════════════════════════════════════╗
║  Rodar Agora                               ║
║  ─────────────────────────────────────     ║
║  [Enquanto rodando]                        ║
║  ⏳ Coletando... (70 farmácias)            ║
║  Iniciado às 23:05                         ║
║                                            ║
║  [Após terminar — sem erros]               ║
║  ✅ Concluído! 70/70 farmácias             ║
║  Duração: 8min 42s                         ║
║                          [Fechar]          ║
║                                            ║
║  [Após terminar — com erros]               ║
║  ⚠️  67/70 farmácias coletadas             ║
║  3 falharam mesmo após retries             ║
║  → Farmácia Boa Saúde (7d, 15d)           ║
║  → Drogaria Central (30d)                 ║
║                          [Fechar]          ║
╚════════════════════════════════════════════╝
```

**Cálculo de duração:**
```ts
// Usar o timestamp do POST /api/rodar-agora como inicio
// e executado_em do ultimo_resultado como fim
const duracao = new Date(ultimoResultado.executado_em).getTime() - iniciadoEm;
const duracaoStr = formatDuration(duracao); // "8min 42s"
```

### 5.2 `GET /api/status` — polling inicial ao carregar a página

Ao montar a aplicação logada, fazer **uma** chamada a `GET /api/status`:
- Se `pipeline_rodando: true` → já inicia o polling (alguém disparou pelo cron ou outra aba)
- Se `ultimo_resultado !== null` e tem erros → exibe o banner imediatamente (erros da última execução)

---

## 6. Gestão de Estado

### PipelineContext

```tsx
// contexts/PipelineContext.tsx

interface PipelineContextType {
  pipelineRodando:  boolean;
  ultimoResultado:  UltimoResultado | null;
  iniciarPipeline:  (opcoes?: { periodos?: number[]; gestorId?: number }) => Promise<void>;
  descartarResultado: () => void;  // fecha o banner manualmente
}

export function PipelineProvider({ children }: { children: React.ReactNode }) {
  const [pipelineRodando, setPipelineRodando] = useState(false);
  const [ultimoResultado, setUltimoResultado] = useState<UltimoResultado | null>(null);
  const [iniciadoEm, setIniciadoEm]           = useState<number | null>(null);

  // Polling
  useEffect(() => {
    if (!pipelineRodando) return;
    const intervalo = setInterval(async () => {
      const data = await fetch('/api/status').then(r => r.json());
      if (!data.pipeline_rodando) {
        setPipelineRodando(false);
        setUltimoResultado(data.ultimo_resultado);
        clearInterval(intervalo);
      }
    }, 5000);
    return () => clearInterval(intervalo);
  }, [pipelineRodando]);

  // Verifica estado ao montar (outro usuário pode ter disparado)
  useEffect(() => {
    fetch('/api/status').then(r => r.json()).then(data => {
      setPipelineRodando(data.pipeline_rodando);
      if (data.ultimo_resultado) setUltimoResultado(data.ultimo_resultado);
    });
  }, []);

  async function iniciarPipeline(opcoes = {}) {
    const res = await fetch('/api/rodar-agora', {
      method: 'POST',
      headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(opcoes),
    });
    if (res.ok) {
      setIniciadoEm(Date.now());
      setPipelineRodando(true);
      setUltimoResultado(null); // limpa resultado anterior
    }
  }

  return (
    <PipelineContext.Provider value={{
      pipelineRodando, ultimoResultado,
      iniciarPipeline,
      descartarResultado: () => setUltimoResultado(null),
    }}>
      {children}
    </PipelineContext.Provider>
  );
}
```

---

## 7. Design Visual

### Paleta de cores por estado

| Estado | Cor principal | Fundo do banner |
|---|---|---|
| Rodando | `#3B82F6` (azul) | `rgba(59,130,246,0.08)` |
| Sucesso | `#10B981` (verde) | `rgba(16,185,129,0.08)` |
| Parcial / erros | `#F59E0B` (âmbar) | `rgba(245,158,11,0.08)` |

### Chips de período nos erros
```
[7d]   background: rgba(59,130,246,0.15)   color: #3B82F6
[15d]  background: rgba(139,92,246,0.15)   color: #8B5CF6
[30d]  background: rgba(16,185,129,0.15)   color: #10B981
```

### Banner — estrutura CSS
```css
.pipeline-banner {
  border-left:    4px solid var(--cor-estado);
  background:     var(--fundo-estado);
  border-radius:  6px;
  padding:        16px 20px;
  margin-bottom:  24px;
}

.pipeline-banner__titulo {
  font-size:   14px;
  font-weight: 600;
  color:       var(--cor-estado);
}

.pipeline-banner__subtitulo {
  font-size: 13px;
  color:     #9CA3AF;
  margin-top: 2px;
}

.pipeline-banner__lista {
  margin-top:   12px;
  padding:      12px;
  background:   rgba(0,0,0,0.2);
  border-radius: 4px;
  font-size:    13px;
}
```

---

## 8. Ordem de Implementação Sugerida

| # | Tarefa | Estimativa | Dependência |
|---|---|---|---|
| 1 | `PipelineContext` + polling | 1h | — |
| 2 | `<PipelineProgressBar />` | 30min | 1 |
| 3 | `<PipelineResultadoBanner />` (versão sucesso) | 45min | 1 |
| 4 | Agrupar erros + versão com erros do banner | 1h | 3 |
| 5 | Chips de período no banner | 20min | 4 |
| 6 | `<FarmaciaBadgeErro />` nos cards | 45min | 1 |
| 7 | Estado inline no modal "Rodar Agora" | 1h | 1 |
| 8 | Verificação de estado ao montar a aplicação | 20min | 1 |

**Total estimado: ~5h30min**

---

## 9. Critérios de Aceite (Definition of Done)

- [ ] Clicar em "Rodar Agora" exibe barra de progresso no topo do Dashboard
- [ ] Barra desaparece e é substituída pelo banner ao terminar
- [ ] Se `totalErros === 0`: banner verde com "X farmácias coletadas"
- [ ] Se `totalErros > 0`: banner âmbar com lista agrupada de farmácias com falha
- [ ] Cada farmácia na lista exibe os chips dos períodos que falharam (`[7d]`, `[15d]`, `[30d]`)
- [ ] Tooltip no chip mostra a mensagem de erro do scraper
- [ ] Cards de farmácias com erro exibem `<FarmaciaBadgeErro />`
- [ ] Banner fecha ao clicar no X
- [ ] Ao carregar a página: se pipeline estava rodando, já inicia o polling automaticamente
- [ ] Ao carregar a página: se tem resultado anterior com erros, exibe o banner
- [ ] `ultimo_resultado === null` não causa erro — trata silenciosamente
- [ ] Funciona em mobile (banner empilha verticalmente em telas < 768px)

---

## 10. Payloads de Referência para Testes

### Simular pipeline com erros (use no estado do Context durante dev)
```ts
const MOCK_COM_ERROS: UltimoResultado = {
  executado_em:    '2026-05-29T23:09:47Z',
  farmaciasTotais: 70,
  totalSucessos:   67,
  totalErros:      3,
  farmaciasComErro: [
    { nome: 'Farmácia Boa Saúde', periodo: 7,  erro: 'Timeout aguardando dashboard' },
    { nome: 'Farmácia Boa Saúde', periodo: 15, erro: 'Timeout aguardando dashboard' },
    { nome: 'Drogaria Central',   periodo: 30, erro: 'Login falhou após 3 tentativas' },
  ],
};

const MOCK_SEM_ERROS: UltimoResultado = {
  executado_em:    '2026-05-29T23:09:47Z',
  farmaciasTotais: 70,
  totalSucessos:   70,
  totalErros:      0,
  farmaciasComErro: [],
};
```
