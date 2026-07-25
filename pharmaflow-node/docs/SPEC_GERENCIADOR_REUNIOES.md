# SPEC — Gerenciador Mensal de Reuniões

**Versão:** 1.0  
**Data:** 2026-06-02  
**Backend base URL:** `https://api.pharmarelatorios.online`  
**Autenticação:** Bearer JWT em todos os endpoints

---

## 1. Visão Geral

O **Gerenciador de Reuniões** é uma tela que permite à equipe da agência ver, mês a mês, **quais clientes (farmácias) tiveram reunião** e **quais não tiveram** — funcionando como um radar de cobertura da agência.

### O que a tela responde

| Pergunta | Onde aparece |
|---|---|
| Quantas farmácias tiveram reunião este mês? | KPIs no topo |
| Quais farmácias NÃO tiveram reunião ainda? | Lista "Sem Reunião" |
| Quais farmácias tiveram reunião e qual foi? | Lista "Com Reunião" |
| Como foi a cobertura nos últimos 6 meses? | Gráfico histórico |

---

## 2. Novos Endpoints (backend já implementado)

### 2.1 Gerenciador Mensal

```
GET /api/reunioes/gerenciador-mensal?mes=2026-06
```

**Query params:**

| Parâmetro | Tipo | Descrição |
|---|---|---|
| `mes` | `YYYY-MM` | Mês desejado. Padrão: mês atual |

**Resposta 200:**
```json
{
  "mes": "2026-06",
  "total_farmacias_ativas": 42,
  "farmacias_com_reuniao": 18,
  "farmacias_sem_reuniao": 24,
  "taxa_cobertura": 42.9,
  "com_reuniao": [
    {
      "farmacia_id": 7,
      "farmacia_nome": "Farmácia Central Ltda",
      "cidade": "São Paulo",
      "responsavel": "João Mendes",
      "telefone": "11999999999",
      "gestor_id": 3,
      "gestor_nome": "Carlos Oliveira",
      "nivel_alerta": "verde",
      "total_reunioes": 2,
      "realizadas": 1,
      "confirmadas": 1,
      "agendadas": 0,
      "reunioes": [
        {
          "id": 45,
          "titulo": "Reunião Mensal Junho",
          "data_reuniao": "2026-06-10T14:00:00Z",
          "duracao_minutos": 60,
          "status": "realizada",
          "observacoes": "Cliente satisfeito com resultados do Google Ads",
          "gestor_id": 3,
          "gestor_nome": "Carlos Oliveira"
        }
      ]
    }
  ],
  "sem_reuniao": [
    {
      "farmacia_id": 12,
      "farmacia_nome": "Farmácia Saúde Plus",
      "cidade": "Recife",
      "responsavel": "Ana Costa",
      "telefone": "81988887777",
      "gestor_id": 5,
      "gestor_nome": "Maria Lima",
      "nivel_alerta": "amarelo"
    }
  ]
}
```

> **Regras do backend:**
> - Apenas farmácias com `fase = 'ativo'` e `ativa = true` são consideradas.
> - Reuniões canceladas não contam para a cobertura.
> - Gestor não-admin vê apenas as farmácias que ele gerencia.

---

### 2.2 Histórico de Cobertura Mensal

```
GET /api/reunioes/cobertura-mensal?meses=6
```

**Query params:**

| Parâmetro | Tipo | Descrição |
|---|---|---|
| `meses` | número | Quantos meses de histórico (1–24). Padrão: 6 |

**Resposta 200:**
```json
{
  "total_farmacias_ativas": 42,
  "historico": [
    {
      "mes": "2026-01",
      "total_farmacias": 42,
      "farmacias_com_reuniao": 10,
      "farmacias_sem_reuniao": 32,
      "taxa_cobertura": 23.8,
      "total_reunioes": 12,
      "realizadas": 9,
      "confirmadas": 2,
      "agendadas": 1
    },
    {
      "mes": "2026-06",
      "total_farmacias": 42,
      "farmacias_com_reuniao": 18,
      "farmacias_sem_reuniao": 24,
      "taxa_cobertura": 42.9,
      "total_reunioes": 22,
      "realizadas": 15,
      "confirmadas": 4,
      "agendadas": 3
    }
  ]
}
```

> Meses sem nenhuma reunião são incluídos no array com valores zerados — o frontend não precisa preencher lacunas.

---

## 3. Estrutura da Tela — `/reunioes/gerenciador`

### 3.1 Layout Geral

```
┌─────────────────────────────────────────────────────────────────┐
│  [← Reuniões]    Gerenciador de Reuniões    [Mês: Jun/2026 ▾]   │
├──────────────────────────────────────────────────────────────── │
│  KPIs:                                                          │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌────────┐ │
│  │ 42 Farmácias │ │ 18 Com Reun. │ │ 24 Sem Reun. │ │ 42.9% │ │
│  │   Ativas     │ │   ✅         │ │   ⚠️         │ │ Cobert.│ │
│  └──────────────┘ └──────────────┘ └──────────────┘ └────────┘ │
├─────────────────────────────────────────────────────────────────│
│  [📊 Evolução]  [✅ Com Reunião (18)]  [❌ Sem Reunião (24)]    │
├─────────────────────────────────────────────────────────────────│
│  (conteúdo da aba selecionada)                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

### 3.2 Aba "Evolução" (Histórico Mensal)

Exibe um gráfico de barras empilhadas (stacked bar) com os últimos 6 meses.

**Dados:** `GET /api/reunioes/cobertura-mensal?meses=6`

```
       42 ┤                              ████
          │                    ████      ████
       30 ┤          ████      ████      ████
          │  ████    ████      ████      ████
       15 ┤  ████    ████      ████      ████
          │  ████    ████      ████      ████
        0 └──────────────────────────────────
          Jan/26  Mar/26  Mai/26  Jun/26

          ■ Com reunião   □ Sem reunião
```

**Abaixo do gráfico:** tabela de resumo com colunas:

| Mês | Total | Com Reunião | Sem Reunião | Cobertura | Realizadas |
|---|---|---|---|---|---|
| Jan/2026 | 42 | 10 | 32 | 23.8% | 9 |
| Jun/2026 | 42 | 18 | 24 | 42.9% | 15 |

> Clicar em uma linha da tabela (ou em uma barra do gráfico) navega para o gerenciador daquele mês específico.

---

### 3.3 Aba "Com Reunião"

Lista das farmácias que tiveram ao menos uma reunião no mês.

**Dados:** array `com_reuniao` do `GET /api/reunioes/gerenciador-mensal`

```
┌─────────────────────────────────────────────────────────────────┐
│  [🔍 Buscar por nome, cidade ou gestor...]                       │
├─────────────────────────────────────────────────────────────────│
│  🟢  Farmácia Central Ltda        SP  |  Gestor: Carlos         │
│      2 reuniões: ✅ 1 realizada, 📅 1 confirmada               │
│      ► Reunião Mensal Junho — 10/06 às 14h — realizada          │
│      ► Estratégia de Leads — 20/06 às 10h — confirmada          │
│      [+ Nova Reunião]                                           │
├─────────────────────────────────────────────────────────────────│
│  🟡  Farmácia Boa Saúde           RJ  |  Gestor: Maria          │
│      1 reunião: 📅 1 agendada                                   │
│      ► Revisão de Campanhas — 28/06 às 15h — agendada           │
│      [+ Nova Reunião]                                           │
└─────────────────────────────────────────────────────────────────┘
```

**Comportamento:**
- Cada card pode ser expandido/recolhido para mostrar a lista de reuniões.
- Botão "+ Nova Reunião" abre o modal de criação pré-preenchido com a farmácia.
- Clicar no nome da farmácia navega para `/farmacias/:id`.
- Clicar em uma reunião específica navega para `/reunioes/:id`.
- Ícone de `nivel_alerta`: 🟢 verde, 🟡 amarelo, 🔴 vermelho.

**Filtros disponíveis (client-side):**
- Busca livre (nome da farmácia, cidade, gestor)
- Status da reunião: `realizadas`, `confirmadas`, `agendadas`
- Gestor (admin vê todos; select de gestores)

---

### 3.4 Aba "Sem Reunião"

Lista das farmácias que **não tiveram nenhuma reunião** no mês selecionado.

**Dados:** array `sem_reuniao` do `GET /api/reunioes/gerenciador-mensal`

```
┌─────────────────────────────────────────────────────────────────┐
│  [🔍 Buscar...]        [Ordenar: Alerta ▾]    24 farmácias      │
├─────────────────────────────────────────────────────────────────│
│  🔴  Farmácia Nova Vida          GO  |  Gestor: Paulo           │
│      Responsável: Roberto Santos | (62) 99876-5432              │
│      [📞 Ligar]  [📅 Agendar Reunião]                          │
├─────────────────────────────────────────────────────────────────│
│  🟡  Farmácia Saúde Plus         PE  |  Gestor: Maria           │
│      Responsável: Ana Costa | (81) 98888-7777                   │
│      [📞 Ligar]  [📅 Agendar Reunião]                          │
├─────────────────────────────────────────────────────────────────│
│  🟢  Farmácia Bem Estar          MG  |  Gestor: Lucas           │
│      Responsável: Carlos Figueira | (31) 97777-6666             │
│      [📞 Ligar]  [📅 Agendar Reunião]                          │
└─────────────────────────────────────────────────────────────────┘
```

**Ordenação padrão:** por `nivel_alerta` (vermelho → amarelo → verde) para priorizar farmácias em risco.

**Comportamento:**
- Botão "📞 Ligar" → abre `tel:` com o telefone do responsável.
- Botão "📅 Agendar Reunião" → abre modal de criação de reunião pré-preenchido com a farmácia.
- Clicar no nome → navega para `/farmacias/:id`.

**Filtros (client-side):**
- Busca livre (nome, cidade, gestor)
- `nivel_alerta`: todos / vermelho / amarelo / verde
- Gestor (somente admin)

---

## 4. Seletor de Mês

O seletor de mês é um componente reutilizável `<MonthPicker>` com navegação por setas:

```
  [  ←  ]   Junho / 2026   [  →  ]
```

- Ao mudar o mês: refaz `GET /api/reunioes/gerenciador-mensal?mes=YYYY-MM`.
- Não permite selecionar mês futuro (botão `→` desabilitado no mês atual).
- Ao carregar a página sem parâmetro de URL: usa o mês atual.
- O mês selecionado é refletido na URL: `/reunioes/gerenciador?mes=2026-06` (para compartilhar e F5).

---

## 5. Chamadas de API por Estado da Tela

| Evento | Endpoint chamado |
|---|---|
| Página carrega | `GET /api/reunioes/gerenciador-mensal` (mês atual) |
| Página carrega | `GET /api/reunioes/cobertura-mensal?meses=6` |
| Muda o mês | `GET /api/reunioes/gerenciador-mensal?mes=YYYY-MM` |
| Clica barra do gráfico | `GET /api/reunioes/gerenciador-mensal?mes=YYYY-MM` |
| Cria reunião pelo modal | `POST /api/reunioes` → recarrega gerenciador |

> As duas chamadas iniciais (`gerenciador-mensal` + `cobertura-mensal`) podem ser disparadas em paralelo com `Promise.all`.

---

## 6. Estados de Loading e Erro

| Situação | Comportamento |
|---|---|
| Carregando dados | Skeleton nos KPIs (4 cards) + skeleton nas listas |
| Nenhuma reunião no mês | Empty state "Nenhuma reunião registrada em Junho/2026" com CTA "Agendar reunião" |
| 100% de cobertura | Badge especial "🎉 Todas as farmácias tiveram reunião!" nos KPIs |
| Erro de rede | Toast de erro com botão "Tentar novamente" |
| Gestor sem farmácias | Empty state "Você não possui farmácias ativas" |

---

## 7. Entrada no Sistema — Navegação

### 7.1 Item no menu lateral

Adicionar item "Reuniões" no menu lateral (ou transformar o link existente `/reunioes` em sub-menu):

```
📅 Reuniões
   ├── 📋 Lista de Reuniões     /reunioes
   └── 📊 Gerenciador Mensal   /reunioes/gerenciador
```

### 7.2 Link rápido no dashboard

No card de KPI de reuniões da tela principal, adicionar link "Ver gerenciador →" que leva para `/reunioes/gerenciador`.

---

## 8. Permissões

| Operação | Admin | Gestor |
|---|---|---|
| Ver gerenciador (todas as farmácias) | ✅ | ❌ |
| Ver gerenciador (somente suas farmácias) | ✅ | ✅ |
| Agendar reunião pelo botão da lista | ✅ | ✅ (só suas farmácias) |
| Ver cobertura mensal histórica | ✅ | ✅ (só suas) |

> O backend já aplica o filtro por gestor automaticamente. O frontend não precisa fazer nada extra além de enviar o token correto.

---

## 9. Resumo dos Endpoints Usados

| Método | Endpoint | Quando usar |
|---|---|---|
| `GET` | `/api/reunioes/gerenciador-mensal?mes=YYYY-MM` | Carregar ou trocar mês |
| `GET` | `/api/reunioes/cobertura-mensal?meses=6` | Histórico do gráfico |
| `POST` | `/api/reunioes` | Agendar nova reunião pelos botões |

---

## 10. Wireframe Completo da Tela

```
╔═══════════════════════════════════════════════════════════════════╗
║  ← Reuniões        Gerenciador de Reuniões        [← Jun/2026 →] ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                   ║
║  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────┐ ║
║  │ 42          │  │ 18          │  │ 24          │  │ 42.9%  │ ║
║  │ Farmácias   │  │ Com Reunião │  │ Sem Reunião │  │Cobertura│ ║
║  └─────────────┘  └─────────────┘  └─────────────┘  └─────────┘ ║
║                                                                   ║
║  [ 📊 Evolução ] [ ✅ Com Reunião (18) ] [ ❌ Sem Reunião (24) ] ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                   ║
║  (ABA: Evolução)                                                  ║
║                                                                   ║
║  Gráfico barras empilhadas — últimos 6 meses                      ║
║  ████░░░░  ████░░░░  █████░░░  ██████░  ███████  ████████        ║
║  Jan      Fev       Mar       Abr      Mai      Jun               ║
║  ■Com  □Sem                                                       ║
║                                                                   ║
║  ┌──────────┬────────┬─────────┬──────────┬──────────┬─────────┐ ║
║  │ Mês      │ Total  │ Com R.  │ Sem R.   │ Cobertura│Realizad.│ ║
║  ├──────────┼────────┼─────────┼──────────┼──────────┼─────────┤ ║
║  │ Jan/2026 │   42   │   10    │    32    │  23.8%   │    9    │ ║
║  │ Jun/2026 │   42   │   18    │    24    │  42.9%   │   15    │ ║
║  └──────────┴────────┴─────────┴──────────┴──────────┴─────────┘ ║
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝
```

```
╔═══════════════════════════════════════════════════════════════════╗
║  (ABA: Sem Reunião — 24 farmácias)                               ║
║                                                                   ║
║  [🔍 Buscar...]              [Alerta ▾]   [Gestor ▾]             ║
║                                                                   ║
║  🔴  Farmácia Nova Vida                 GO | Gestor: Paulo       ║
║      Roberto Santos  |  (62) 99876-5432                          ║
║      [📞 Ligar]   [📅 Agendar Reunião]                           ║
║  ─────────────────────────────────────────────────────────────── ║
║  🟡  Farmácia Saúde Plus                PE | Gestor: Maria       ║
║      Ana Costa  |  (81) 98888-7777                               ║
║      [📞 Ligar]   [📅 Agendar Reunião]                           ║
║  ─────────────────────────────────────────────────────────────── ║
║  🟢  Farmácia Bem Estar                 MG | Gestor: Lucas       ║
║      Carlos Figueira  |  (31) 97777-6666                         ║
║      [📞 Ligar]   [📅 Agendar Reunião]                           ║
╚═══════════════════════════════════════════════════════════════════╝
```
