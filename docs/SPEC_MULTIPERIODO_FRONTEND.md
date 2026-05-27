# SPEC TÉCNICO — Feature Multi-Período (7 / 15 / 30 dias)
**PharmaFlow v2 — Frontend**
**Tech Lead:** Claude (Sonnet 4.6)
**Data:** 2026-05-26
**Status:** Pronto para implementação

---

## 1. Contexto e Objetivo

O backend agora armazena coletas separadas por período (`periodo_dias = 7 | 15 | 30`).
O objetivo desta feature é expor esses dados de forma que líderes consigam, **sem rodar nenhuma automação**,
responder às perguntas:

> *"Como foi a farmácia nos últimos 7 dias? E nos últimos 15? E no mês?"*
> *"Qual período tem a melhor taxa de conversão?"*
> *"A receita de 30 dias está crescendo em relação à semana?"*

### 1.1 Lógica de datas por período

| Período | Tipo | Exemplo (hoje = 27/05) |
|---|---|---|
| **7 dias** | Janela rolante | 21/05 → 27/05 |
| **15 dias** | Janela rolante | 13/05 → 27/05 |
| **30 dias** | Mês anterior fechado | 01/04 → 30/04 |

> ⚠️ O período de 30 dias é sempre o **mês anterior completo** (fechado), não os últimos 30 dias corridos.
> Isso garante que líderes comparem sempre o mesmo período fixo, sem os dados mudarem dia a dia.

---

## 2. Arquitetura da Feature

### 2.1 Dois níveis de visualização de período

```
┌─────────────────────────────────────────────────────────────┐
│  NÍVEL 1 — Seletor Global (Dashboard / Painel)              │
│  [7 dias]  [15 dias]  [30 dias]  ← abas no topo da página  │
│  Toda a página reage ao período selecionado                 │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  NÍVEL 2 — Comparativo por Farmácia (detalhe)               │
│  Dentro de cada farmácia: 3 colunas lado a lado             │
│  [ 7 dias | 15 dias | 30 dias ] simultaneamente             │
│  Líderes veem a evolução de uma vez, sem clicar             │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. API Contract (Backend → Frontend)

### Base URL
```
https://api.pharmarelatorios.online
```

### Endpoints com suporte a `?dias=`

| Endpoint | Parâmetro | Valores | Default |
|---|---|---|---|
| `GET /api/painel` | `?dias=` | 7, 15, 30 | 7 |
| `GET /api/farmacias` | `?dias=` | 7, 15, 30 | 7 |
| `GET /api/farmacias/:id/evolucao` | `?dias=` | 7, 15, 30 | 7 |

### Exemplo de chamada
```ts
// Painel de 30 dias
fetch('/api/painel?dias=30', { headers: { Authorization: `Bearer ${token}` } })

// Lista de farmácias de 15 dias
fetch('/api/farmacias?dias=15', { headers: { Authorization: `Bearer ${token}` } })

// Evolução de uma farmácia específica em 7 dias
fetch('/api/farmacias/3/evolucao?dias=7', { headers: { Authorization: `Bearer ${token}` } })
```

### Para buscar os 3 períodos de uma farmácia de uma vez (comparativo):
```ts
const [d7, d15, d30] = await Promise.all([
  fetch('/api/farmacias/3/evolucao?dias=7',  { headers }),
  fetch('/api/farmacias/3/evolucao?dias=15', { headers }),
  fetch('/api/farmacias/3/evolucao?dias=30', { headers }),
]);
```

---

## 4. Componentes Novos

### 4.1 `<PeriodSelector />` — Seletor Global

**Localização:** topo do Dashboard, acima de todos os cards.

```
╔═══════════════════════════════════════════════╗
║  📅  Período de análise                        ║
║  ┌─────────┐  ┌──────────┐  ┌──────────┐      ║
║  │  7 dias │  │  15 dias │  │  30 dias │      ║
║  └─────────┘  └──────────┘  └──────────┘      ║
║   ↑ ativo (fundo verde, borda sólida)          ║
╚═══════════════════════════════════════════════╝
```

**Comportamento:**
- Estado global (Context ou store) `selectedPeriod: 7 | 15 | 30`
- Ao trocar, **re-fetcha** `/api/painel?dias=X` e `/api/farmacias?dias=X`
- Salva a preferência em `localStorage` (persiste entre sessões)
- Mostra um badge no botão ativo com o label `"Período ativo"`

**Props:**
```ts
interface PeriodSelectorProps {
  value: 7 | 15 | 30;
  onChange: (dias: 7 | 15 | 30) => void;
}
```

---

### 4.2 `<PeriodBadge />` — Badge de período nos cards

Pequeno chip visual exibido em cada card de farmácia indicando qual período está sendo exibido.

```
╔════════════════════════════╗
║  Farmácia São Rafael       ║
║  ┌──────────┐              ║
║  │ 📅 15d  │  ← badge     ║
║  └──────────┘              ║
║  Receita: R$ 89.230,00     ║
╚════════════════════════════╝
```

**Props:**
```ts
interface PeriodBadgeProps {
  dias: 7 | 15 | 30;
}
```

---

### 4.3 `<FarmaciaComparativoPanel />` — O destaque da feature

**Localização:** Dentro da página de detalhe de cada farmácia.

Este é o componente principal que os líderes vão usar para comparar períodos.
Exibe **3 colunas lado a lado**, cada uma com os KPIs do respectivo período.

```
╔══════════════════════════════════════════════════════════════════════╗
║  Farmácia: São Rafael — Comparativo de Períodos                      ║
╠══════════════════╦═══════════════════╦══════════════════════════════╣
║   7 dias         ║   15 dias         ║   30 dias                    ║
╠══════════════════╬═══════════════════╬══════════════════════════════╣
║  💰 R$ 45.200   ║  💰 R$ 89.800    ║  💰 R$ 179.962              ║
║  🛒 1.100 vend  ║  🛒 2.200 vend   ║  🛒 2.325 vend              ║
║  👥 4.500 atend ║  👥 9.100 atend  ║  👥 12.400 atend            ║
║  📊 Score: 72   ║  📊 Score: 68    ║  📊 Score: 65               ║
║  🟢 Verde       ║  🟡 Amarelo      ║  🟢 Verde                   ║
╠══════════════════╩═══════════════════╩══════════════════════════════╣
║  [Gráfico de barras agrupadas: Receita por período]                  ║
║                                                                      ║
║   200k ┤                              ▓▓                            ║
║   100k ┤          ▓▓     ▓▓          ▓▓                            ║
║     0k ┤    ▓▓    ▓▓     ▓▓          ▓▓                            ║
║         7d     15d     30d                                           ║
╚══════════════════════════════════════════════════════════════════════╝
```

**Dados necessários:**
```ts
// Fazer 3 chamadas em paralelo
const [p7, p15, p30] = await Promise.all([
  fetchFarmacia(id, 7),
  fetchFarmacia(id, 15),
  fetchFarmacia(id, 30),
]);
```

**Gráficos dentro do comparativo:**
1. Barra agrupada — Receita (7d / 15d / 30d)
2. Barra agrupada — Vendas (7d / 15d / 30d)
3. Barra agrupada — Atendimentos (7d / 15d / 30d)
4. Gráfico de pizza — Canais do período selecionado (usa o período global)

**Props:**
```ts
interface FarmaciaComparativoPanelProps {
  farmaciaId: number;
  farmaciaNome: string;
}
```

---

### 4.4 `<KpiComparativoCard />` — KPI com seta de tendência

Card individual de KPI que mostra o valor e a tendência entre períodos.

```
╔══════════════════════════╗
║  💰 Receita Total        ║
║                          ║
║  R$ 179.962              ║  ← período atual (30d)
║                          ║
║  ▲ +99% vs 7 dias       ║  ← comparação automática
║  ▲ +100% vs 15 dias     ║
╚══════════════════════════╝
```

**Lógica de tendência:**
```ts
const tendencia = ((valor30d - valor7d) / valor7d) * 100;
// Positivo → seta verde pra cima ▲
// Negativo → seta vermelha pra baixo ▼
```

---

## 5. Alterações em Componentes Existentes

### 5.1 Dashboard / Painel Principal

**Antes:** Carrega `/api/painel` uma vez.
**Depois:**
- Adiciona `<PeriodSelector />` no topo
- Re-fetcha com `?dias=${selectedPeriod}` ao mudar
- Exibe `<PeriodBadge dias={selectedPeriod} />` nos cards de resumo

```tsx
// Exemplo de integração
const [period, setPeriod] = useState<7|15|30>(
  Number(localStorage.getItem('pharma_period') || 7) as 7|15|30
);

useEffect(() => {
  localStorage.setItem('pharma_period', String(period));
  fetchPainel(period);
  fetchFarmacias(period);
}, [period]);
```

### 5.2 Página de Lista de Farmácias

**Antes:** Carrega `/api/farmacias` sem parâmetro.
**Depois:**
- Passa `?dias=${selectedPeriod}`
- Cada card de farmácia mostra `<PeriodBadge />`
- No header da tabela/lista: texto `"Dados dos últimos ${selectedPeriod} dias"`

### 5.3 Página de Detalhe da Farmácia

**Antes:** Mostra apenas a última coleta.
**Depois:**
- Adiciona `<FarmaciaComparativoPanel farmaciaId={id} />` acima dos gráficos existentes
- O seletor de período local permite alternar sem afetar o global

---

## 6. Gestão de Estado

### Recomendação: Context API (sem biblioteca externa)

```tsx
// contexts/PeriodContext.tsx
import { createContext, useContext, useState, useEffect } from 'react';

type Period = 7 | 15 | 30;

interface PeriodContextType {
  period: Period;
  setPeriod: (p: Period) => void;
}

const PeriodContext = createContext<PeriodContextType>({} as PeriodContextType);

export function PeriodProvider({ children }: { children: React.ReactNode }) {
  const [period, setPeriodState] = useState<Period>(
    Number(localStorage.getItem('pharma_period') || 7) as Period
  );

  function setPeriod(p: Period) {
    localStorage.setItem('pharma_period', String(p));
    setPeriodState(p);
  }

  return (
    <PeriodContext.Provider value={{ period, setPeriod }}>
      {children}
    </PeriodContext.Provider>
  );
}

export const usePeriod = () => useContext(PeriodContext);
```

**Uso em qualquer componente:**
```tsx
const { period, setPeriod } = usePeriod();
```

---

## 7. Design Visual — Guia de Estilos

### Cores por período
```
7 dias  → Azul    #3B82F6  (urgente, recente)
15 dias → Roxo    #8B5CF6  (médio prazo)
30 dias → Verde   #10B981  (visão mensal)
```

### PeriodSelector — estados visuais
```css
/* Botão inativo */
border: 1px solid #374151;
background: transparent;
color: #9CA3AF;

/* Botão ativo — 7 dias (azul) */
border: 2px solid #3B82F6;
background: rgba(59, 130, 246, 0.1);
color: #3B82F6;
font-weight: 600;

/* Botão ativo — 15 dias (roxo) */
border: 2px solid #8B5CF6;
background: rgba(139, 92, 246, 0.1);
color: #8B5CF6;

/* Botão ativo — 30 dias (verde) */
border: 2px solid #10B981;
background: rgba(16, 185, 129, 0.1);
color: #10B981;
```

### Gráfico de barras comparativo (biblioteca Recharts recomendada)
```tsx
// Cores das barras no gráfico agrupado
const CORES = {
  7:  '#3B82F6',   // azul
  15: '#8B5CF6',   // roxo
  30: '#10B981',   // verde
};
```

---

## 8. Loading States

Durante o fetch (quando o usuário troca de período):

```
1. Exibir skeleton nos cards KPI (não apagar os dados antigos de uma vez)
2. Após 200ms sem resposta → mostrar spinner no PeriodSelector
3. Após resposta → atualizar com fade-in (transition: opacity 0.3s)
```

**Não usar:** loading de página inteira (evita sensação de lentidão).

---

## 9. Tratamento de Dados Zerados

Se um período ainda não tiver sido coletado (ex: 15 dias nunca rodou), a API retorna zeros.
O frontend deve exibir uma mensagem amigável:

```
╔══════════════════════════════╗
║  📭 Sem dados para 15 dias   ║
║  Execute a automação para    ║
║  popular este período.       ║
╚══════════════════════════════╝
```

**Lógica de detecção:**
```ts
const semDados = farmacia.receita_total === 0 && farmacia.total_atendimentos === 0;
```

---

## 10. Ordem de Implementação Sugerida

| # | Componente | Estimativa | Dependência |
|---|---|---|---|
| 1 | `PeriodContext` | 30 min | — |
| 2 | `PeriodSelector` | 1h | Context |
| 3 | Integrar seletor no Dashboard | 1h | 1 + 2 |
| 4 | Integrar seletor na Lista de Farmácias | 45 min | 1 + 2 |
| 5 | `FarmaciaComparativoPanel` | 3h | Context |
| 6 | `KpiComparativoCard` com tendência | 1h | 5 |
| 7 | Gráfico de barras agrupadas (Recharts) | 2h | 5 |
| 8 | Loading skeletons e fade-in | 1h | 3 + 4 + 5 |
| 9 | `localStorage` persistência | 15 min | 1 |

**Total estimado: ~10h de desenvolvimento**

---

## 11. Critérios de Aceite (Definition of Done)

- [ ] Trocar de período no seletor global atualiza todos os cards do painel
- [ ] Preferência de período persiste ao recarregar a página
- [ ] Página de detalhe de farmácia exibe os 3 períodos lado a lado
- [ ] Gráfico comparativo mostra 3 barras por métrica (receita, vendas, atend.)
- [ ] Card de KPI exibe percentual de diferença entre períodos
- [ ] Período sem dados exibe mensagem amigável (não zeros em branco)
- [ ] Loading não pisca a página inteira ao trocar período
- [ ] Funciona em mobile (layout responsivo: colunas empilhadas em telas < 768px)

---

## 12. Exemplo de Payload da API (referência)

### `GET /api/painel?dias=30`
```json
{
  "receita_total": 208116.79,
  "total_atendimentos": 12400,
  "vendas_realizadas": 2713,
  "farmacias_ativas": 2,
  "farmacias_alerta": 0,
  "farmacias_atencao": 0,
  "taxa_conversao_media": 21.87,
  "ultima_atualizacao": "2026-05-26T20:16:59Z",
  "canais": [
    { "nome": "Google",  "atendimentos": 6200, "vendas": 1350, "receita_vendas": 110000 },
    { "nome": "Meta",    "atendimentos": 4100, "vendas": 980,  "receita_vendas": 65000  },
    { "nome": "Grupos",  "atendimentos": 2100, "vendas": 383,  "receita_vendas": 33116  }
  ]
}
```

### `GET /api/farmacias?dias=7`
```json
[
  {
    "id": 1,
    "nome": "São Rafael",
    "periodo_inicio": "2026-05-19",
    "periodo_fim": "2026-05-26",
    "receita_total": 45200.00,
    "total_atendimentos": 4500,
    "vendas_realizadas": 1100,
    "nivel_alerta": "verde",
    "score_criticidade": 72,
    "canais": [...]
  }
]
```

---

*Documento gerado pelo Tech Lead. Qualquer dúvida de implementação, consultar o arquivo `SPEC_FRONTEND.md` existente para convenções de código do projeto.*
