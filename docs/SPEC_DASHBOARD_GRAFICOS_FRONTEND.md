# SPEC TÉCNICO — Dashboard de Gráficos (Vendas + Reuniões Perdidas)
**PharmaFlow v2 — Frontend**
**Tech Lead:** Claude (Sonnet 4.6)
**Data:** 2026-05-27
**Status:** Pronto para implementação

---

## 1. Objetivo

Criar uma página (ou seção) de dashboard com gráficos que respondem:

> *"Como estão as vendas nos últimos 7 e 30 dias?"*
> *"Estou perdendo muitas reuniões? Qual farmácia cancela mais?"*
> *"A tendência de vendas está subindo ou caindo?"*

---

## 2. Onde Fica no App

**Opção A — Nova página `/dashboard`** (recomendada)
- Item no menu lateral: 📊 Dashboard (entre "Painel Geral" e "Farmácias")

**Opção B — Seção na página existente `/painel`**
- Adiciona os gráficos abaixo dos cards de KPI existentes

---

## 3. Layout Geral da Página

```
╔══════════════════════════════════════════════════════════════════════╗
║  📊 Dashboard de Performance                                          ║
╠══════════════════════════════════════════════════════════════════════╣
║                                                                      ║
║  ── SEÇÃO 1: Vendas ───────────────────────────────────────────────  ║
║                                                                      ║
║  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               ║
║  │ 💰 Receita   │  │ 🛒 Vendas    │  │ 📈 Variação  │               ║
║  │  7 dias      │  │  7 dias      │  │  vs semana   │               ║
║  │ R$45.200     │  │ 1.100        │  │ ▲ +12%       │               ║
║  └──────────────┘  └──────────────┘  └──────────────┘               ║
║                                                                      ║
║  ┌──────────────────────────────────────────────────────────────┐    ║
║  │  Evolução de Vendas            [7 dias] [30 dias]            │    ║
║  │                                                              │    ║
║  │  200k ┤                                        ╭─╮           │    ║
║  │  150k ┤                              ╭─╮      ╯  ╰─          │    ║
║  │  100k ┤                    ╭─╮      ╯  ╰─╮                   │    ║
║  │   50k ┤          ╭─╮      ╯  ╰─╮         ╰─                  │    ║
║  │    0k ┤──────────╯  ╰──────────╯                             │    ║
║  │        Mai/05    Mai/12    Mai/19    Mai/26                   │    ║
║  │        ── Receita 7d    ── Receita 30d (proporcional)        │    ║
║  └──────────────────────────────────────────────────────────────┘    ║
║                                                                      ║
║  ── SEÇÃO 2: Reuniões ─────────────────────────────────────────────  ║
║                                                                      ║
║  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               ║
║  │ 📅 Total     │  │ ✅ Realizadas│  │ ❌ Taxa Perda│               ║
║  │  90 dias     │  │              │  │              │               ║
║  │     10       │  │  6 (60%)     │  │  20%         │               ║
║  └──────────────┘  └──────────────┘  └──────────────┘               ║
║                                                                      ║
║  ┌────────────────────────────┐  ┌────────────────────────────┐      ║
║  │  Distribuição de Status    │  │  Taxa de Perda por Farmácia│      ║
║  │                            │  │                            │      ║
║  │       ╭────╮               │  │  São Rafael   ███ 33%      │      ║
║  │    ╭──╯ 60%╰──╮            │  │  Hiper-pop    ██  20%      │      ║
║  │    │ Realizadas│            │  │  Sales Paiva  █   10%      │      ║
║  │    ╰──╮    ╭──╯            │  │  Panfarma      0%           │      ║
║  │       ╰────╯               │  │                            │      ║
║  │  ● Realizadas  60%         │  │                            │      ║
║  │  ● Canceladas  20%         │  │                            │      ║
║  │  ● Agendadas   20%         │  │                            │      ║
║  └────────────────────────────┘  └────────────────────────────┘      ║
║                                                                      ║
║  ┌──────────────────────────────────────────────────────────────┐    ║
║  │  Evolução Mensal de Reuniões (últimos 6 meses)               │    ║
║  │                                                              │    ║
║  │   8 ┤                              ▓▓                        │    ║
║  │   6 ┤         ▓▓          ▓▓       ▓▓  ░░                    │    ║
║  │   4 ┤  ▓▓     ▓▓  ░░     ▓▓  ░░   ▓▓  ░░                    │    ║
║  │   2 ┤  ▓▓     ▓▓  ░░     ▓▓  ░░   ▓▓  ░░                    │    ║
║  │   0 ┤──────────────────────────────────────                  │    ║
║  │      Dez   Jan    Fev    Mar    Abr    Mai                   │    ║
║  │      ▓ Realizadas   ░ Canceladas                             │    ║
║  └──────────────────────────────────────────────────────────────┘    ║
╚══════════════════════════════════════════════════════════════════════╝
```

---

## 4. Endpoints da API

### Base URL
```
https://api.pharmarelatorios.online
```

### 4.1 Evolução de Vendas

```
GET /api/dashboard/evolucao
GET /api/dashboard/evolucao?gestor_id=2   ← admin filtrando por gestor
```

**Resposta:**
```json
{
  "serie_7d": [
    { "data": "2026-05-12", "vendas": 980,  "receita": 38500, "atendimentos": 3900 },
    { "data": "2026-05-19", "vendas": 1050, "receita": 42000, "atendimentos": 4200 },
    { "data": "2026-05-26", "vendas": 1100, "receita": 45200, "atendimentos": 4500 }
  ],
  "serie_30d": [
    { "data": "2026-04-26", "vendas": 3800, "receita": 162000, "atendimentos": 15000 },
    { "data": "2026-05-26", "vendas": 4400, "receita": 179962, "atendimentos": 18000 }
  ],
  "ultimo_7d":  { "data": "2026-05-26", "vendas": 1100, "receita": 45200, "atendimentos": 4500 },
  "ultimo_30d": { "data": "2026-05-26", "vendas": 4400, "receita": 179962, "atendimentos": 18000 },
  "variacao_vendas": 0.0,
  "variacao_receita": 2.3
}
```

**Quando chamar:** ao entrar na página. Sem parâmetros para o gestor logado; admin pode filtrar.

---

### 4.2 Taxa de Reuniões Perdidas

```
GET /api/dashboard/reunioes-perda
```

**Resposta:**
```json
{
  "total": 10,
  "realizadas": 6,
  "canceladas": 2,
  "confirmadas": 1,
  "agendadas": 1,
  "taxa_realizacao": 60.0,
  "taxa_perda": 20.0,

  "distribuicao": [
    { "status": "Realizadas",  "valor": 6, "cor": "#10B981" },
    { "status": "Canceladas",  "valor": 2, "cor": "#EF4444" },
    { "status": "Confirmadas", "valor": 1, "cor": "#3B82F6" },
    { "status": "Agendadas",   "valor": 1, "cor": "#F59E0B" }
  ],

  "por_farmacia": [
    { "farmacia_nome": "São Rafael",  "total": 3, "realizadas": 2, "canceladas": 1, "taxa_perda": 33.3 },
    { "farmacia_nome": "Hiper-popular","total": 5, "realizadas": 4, "canceladas": 1, "taxa_perda": 20.0 },
    { "farmacia_nome": "Sales Paiva", "total": 2, "realizadas": 0, "canceladas": 0, "taxa_perda": 0.0  }
  ],

  "evolucao_mensal": [
    { "mes": "2025-12", "total": 4, "realizadas": 3, "canceladas": 1, "taxa_perda": 25.0 },
    { "mes": "2026-01", "total": 6, "realizadas": 5, "canceladas": 1, "taxa_perda": 16.7 },
    { "mes": "2026-05", "total": 10,"realizadas": 6, "canceladas": 2, "taxa_perda": 20.0 }
  ]
}
```

---

### 4.3 Chamadas Paralelas ao Carregar

```ts
const [evolucao, reunioesPerda] = await Promise.all([
  fetch('/api/dashboard/evolucao',        { headers }),
  fetch('/api/dashboard/reunioes-perda',  { headers }),
]);
```

---

## 5. Componentes a Criar

### 5.1 `<VendasKpiCards />`

Três cards no topo da seção de vendas:

```
┌─────────────────────────────────────────────┐
│  💰 Receita (7d)   🛒 Vendas (7d)   📈 vs mês │
│  R$ 45.200         1.100             ▲ +2.3%  │
└─────────────────────────────────────────────┘
```

**Dados:**
```ts
const { ultimo_7d, ultimo_30d, variacao_receita, variacao_vendas } = evolucao;
```

**Seta de variação:**
```tsx
const Variacao = ({ pct }: { pct: number | null }) => {
  if (pct === null) return <span>—</span>;
  return pct >= 0
    ? <span style={{ color: '#10B981' }}>▲ +{pct}%</span>
    : <span style={{ color: '#EF4444' }}>▼ {pct}%</span>;
};
```

---

### 5.2 `<GraficoEvolucaoVendas />` — Gráfico de linha (Recharts)

```tsx
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

// Mesclar série 7d e 30d no mesmo eixo X por data
const dadosMesclados = mergeSeriesByDate(evolucao.serie_7d, evolucao.serie_30d);

<ResponsiveContainer width="100%" height={300}>
  <LineChart data={dadosMesclados}>
    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
    <XAxis dataKey="data" tickFormatter={formatarData} stroke="#9CA3AF" />
    <YAxis tickFormatter={formatarReceita} stroke="#9CA3AF" />
    <Tooltip
      formatter={(value: number) => `R$ ${value.toLocaleString('pt-BR')}`}
      contentStyle={{ background: '#1F2937', border: '1px solid #374151' }}
    />
    <Legend />
    <Line type="monotone" dataKey="receita_7d"  stroke="#3B82F6" strokeWidth={2}
          name="Receita 7 dias"  dot={{ fill: '#3B82F6' }} />
    <Line type="monotone" dataKey="receita_30d" stroke="#10B981" strokeWidth={2}
          name="Receita 30 dias" dot={{ fill: '#10B981' }} strokeDasharray="5 5" />
  </LineChart>
</ResponsiveContainer>
```

**Função para mesclar as séries:**
```ts
function mergeSeriesByDate(serie7d: Ponto[], serie30d: Ponto[]) {
  const mapa: Record<string, any> = {};

  serie7d.forEach(p => {
    mapa[p.data] = { ...mapa[p.data], data: p.data, receita_7d: p.receita, vendas_7d: p.vendas };
  });
  serie30d.forEach(p => {
    // 30d representa ~4 semanas — divide por 4 para comparar com 7d
    mapa[p.data] = { ...mapa[p.data], data: p.data, receita_30d: p.receita / 4, vendas_30d: p.vendas / 4 };
  });

  return Object.values(mapa).sort((a, b) => a.data.localeCompare(b.data));
}
```

**Toggle 7d / 30d:**
```tsx
// Botões para mostrar apenas vendas ou receita
const [metrica, setMetrica] = useState<'receita' | 'vendas' | 'atendimentos'>('receita');
```

---

### 5.3 `<ReunioesPerdaKpis />` — Cards de reuniões

```
┌─────────────────────────────────────────┐
│  📅 Total   ✅ Realizadas  ❌ Taxa Perda │
│    10           6 (60%)       20%        │
└─────────────────────────────────────────┘
```

**Cor da taxa de perda:**
```ts
const corPerda = taxa_perda === 0     ? '#10B981'  // verde
               : taxa_perda <= 20     ? '#F59E0B'  // amarelo
               : /* > 20% */            '#EF4444'; // vermelho
```

---

### 5.4 `<GraficoDonutStatus />` — Donut de distribuição

```tsx
import { PieChart, Pie, Cell, Tooltip, Legend } from 'recharts';

<PieChart width={280} height={280}>
  <Pie
    data={reunioesPerda.distribuicao}
    dataKey="valor"
    nameKey="status"
    cx="50%"
    cy="50%"
    innerRadius={70}
    outerRadius={110}
    paddingAngle={3}
  >
    {reunioesPerda.distribuicao.map((entry, i) => (
      <Cell key={i} fill={entry.cor} />
    ))}
  </Pie>
  <Tooltip
    formatter={(v: number, name: string) => [`${v} reuniões`, name]}
    contentStyle={{ background: '#1F2937', border: '1px solid #374151' }}
  />
  <Legend />
</PieChart>

{/* Label central */}
<div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center' }}>
  <div style={{ fontSize: 28, fontWeight: 700 }}>{reunioesPerda.total}</div>
  <div style={{ fontSize: 12, color: '#9CA3AF' }}>reuniões</div>
</div>
```

---

### 5.5 `<RankingPerdaPorFarmacia />` — Barras horizontais

```tsx
import { BarChart, Bar, XAxis, YAxis, Tooltip, Cell, ResponsiveContainer } from 'recharts';

<ResponsiveContainer width="100%" height={250}>
  <BarChart
    data={reunioesPerda.por_farmacia}
    layout="vertical"
    margin={{ left: 80 }}
  >
    <XAxis type="number" domain={[0, 100]} unit="%" stroke="#9CA3AF" />
    <YAxis type="category" dataKey="farmacia_nome" stroke="#9CA3AF" width={80} />
    <Tooltip
      formatter={(v: number) => [`${v}%`, 'Taxa de perda']}
      contentStyle={{ background: '#1F2937', border: '1px solid #374151' }}
    />
    <Bar dataKey="taxa_perda" radius={[0, 4, 4, 0]}>
      {reunioesPerda.por_farmacia.map((entry, i) => (
        <Cell
          key={i}
          fill={
            entry.taxa_perda === 0  ? '#10B981'
            : entry.taxa_perda <= 20 ? '#F59E0B'
            :                         '#EF4444'
          }
        />
      ))}
    </Bar>
  </BarChart>
</ResponsiveContainer>
```

---

### 5.6 `<GraficoEvolucaoReunioes />` — Barras mensais empilhadas

```tsx
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

<ResponsiveContainer width="100%" height={250}>
  <BarChart data={reunioesPerda.evolucao_mensal}>
    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
    <XAxis dataKey="mes" tickFormatter={formatarMes} stroke="#9CA3AF" />
    <YAxis stroke="#9CA3AF" allowDecimals={false} />
    <Tooltip contentStyle={{ background: '#1F2937', border: '1px solid #374151' }} />
    <Legend />
    <Bar dataKey="realizadas" name="Realizadas" fill="#10B981" stackId="a" radius={[0, 0, 0, 0]} />
    <Bar dataKey="canceladas" name="Canceladas" fill="#EF4444" stackId="a" radius={[4, 4, 0, 0]} />
  </BarChart>
</ResponsiveContainer>
```

---

## 6. Instalação da Biblioteca de Gráficos

```bash
npm install recharts
# ou
yarn add recharts
```

> Recharts já é compatível com React e Tailwind. Não requer configuração extra.

---

## 7. Funções Utilitárias

```ts
// Formata data "2026-05-26" → "26/Mai"
export const formatarData = (data: string) => {
  const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const [, mes, dia] = data.split('-');
  return `${dia}/${meses[parseInt(mes) - 1]}`;
};

// Formata mês "2026-05" → "Mai/26"
export const formatarMes = (mes: string) => {
  const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const [ano, m] = mes.split('-');
  return `${meses[parseInt(m) - 1]}/${ano.slice(2)}`;
};

// Formata receita para eixo Y
export const formatarReceita = (valor: number) => {
  if (valor >= 1_000_000) return `R$${(valor / 1_000_000).toFixed(1)}M`;
  if (valor >= 1_000)     return `R$${(valor / 1_000).toFixed(0)}k`;
  return `R$${valor}`;
};
```

---

## 8. Gestão de Estado

```tsx
interface DashboardState {
  evolucao:       EvolucaoData | null;
  reunioesPerda:  ReunioesPerdaData | null;
  carregando:     boolean;
  erro:           string | null;
  // UI
  metricaAtiva:   'receita' | 'vendas' | 'atendimentos';
}

// Carregamento paralelo ao montar
useEffect(() => {
  async function carregar() {
    setCarregando(true);
    try {
      const [ev, rp] = await Promise.all([
        fetch('/api/dashboard/evolucao',       { headers }).then(r => r.json()),
        fetch('/api/dashboard/reunioes-perda', { headers }).then(r => r.json()),
      ]);
      setEvolucao(ev);
      setReunioesPerdas(rp);
    } catch {
      setErro('Erro ao carregar dados do dashboard.');
    } finally {
      setCarregando(false);
    }
  }
  carregar();
}, []);
```

---

## 9. Loading State

```tsx
// Skeleton para os cards KPI
const SkeletonCard = () => (
  <div style={{
    background: '#1F2937', borderRadius: 8, padding: 20,
    animation: 'pulse 1.5s ease-in-out infinite'
  }}>
    <div style={{ height: 12, background: '#374151', borderRadius: 4, marginBottom: 8, width: '60%' }} />
    <div style={{ height: 28, background: '#374151', borderRadius: 4, width: '80%' }} />
  </div>
);

// Skeleton para o gráfico
const SkeletonGrafico = () => (
  <div style={{
    height: 300, background: '#1F2937', borderRadius: 8,
    display: 'flex', alignItems: 'center', justifyContent: 'center'
  }}>
    <span style={{ color: '#6B7280' }}>Carregando gráfico...</span>
  </div>
);
```

---

## 10. Estado Sem Dados

Se não houver coletas ainda:
```tsx
{evolucao.serie_7d.length === 0 && (
  <div style={{ textAlign: 'center', padding: 40, color: '#6B7280' }}>
    📭 Nenhuma coleta registrada ainda.
    <br />
    Execute a automação para popular os gráficos.
  </div>
)}
```

Se não houver reuniões:
```tsx
{reunioesPerda.total === 0 && (
  <div style={{ textAlign: 'center', padding: 40, color: '#6B7280' }}>
    📅 Nenhuma reunião nos últimos 90 dias.
  </div>
)}
```

---

## 11. Cores e Tema

```ts
// Consistente com o resto do PharmaFlow
const TEMA = {
  bg_card:      '#1F2937',
  bg_hover:     '#374151',
  borda:        '#374151',
  texto:        '#F9FAFB',
  texto_muted:  '#9CA3AF',

  // Métricas
  verde:        '#10B981',   // positivo / realizado
  amarelo:      '#F59E0B',   // atenção
  vermelho:     '#EF4444',   // alerta / cancelado
  azul:         '#3B82F6',   // 7 dias
  roxo:         '#8B5CF6',   // 15 dias
  verde_30d:    '#10B981',   // 30 dias
};
```

---

## 12. Ordem de Implementação

| # | Componente | Tempo |
|---|-----------|-------|
| 1 | Instalar Recharts + criar página `/dashboard` | 15 min |
| 2 | Chamadas paralelas + loading state | 30 min |
| 3 | `<VendasKpiCards />` | 30 min |
| 4 | `<GraficoEvolucaoVendas />` | 1h |
| 5 | `<ReunioesPerdaKpis />` | 20 min |
| 6 | `<GraficoDonutStatus />` | 45 min |
| 7 | `<RankingPerdaPorFarmacia />` | 45 min |
| 8 | `<GraficoEvolucaoReunioes />` | 45 min |
| 9 | Estado sem dados + erros | 20 min |

**Total estimado: ~5h**

---

## 13. Critérios de Aceite

- [ ] Gráfico de linha mostra evolução de receita dos últimos 7 e 30 dias
- [ ] Cards KPI mostram último valor 7d com variação vs proporcional 30d
- [ ] Donut exibe distribuição correta de status das reuniões
- [ ] Barras horizontais mostram taxa de perda por farmácia com cor correta (verde/amarelo/vermelho)
- [ ] Gráfico de barras mensais empilhadas mostra realizadas vs canceladas
- [ ] Loading skeleton durante o fetch (não tela em branco)
- [ ] Mensagem amigável quando não há dados
- [ ] Responsivo: gráficos adaptam em mobile (usar `ResponsiveContainer`)
- [ ] Tooltip em português com formatação de moeda brasileira

---

*Backend: dois novos endpoints implementados em `pharmaflow-node/src/api/index.ts`*
*Biblioteca de gráficos recomendada: **Recharts** (recharts.org)*
