# SPEC — Sistema de Ações de Marketing

**Versão:** 1.0  
**Data:** 2026-06-02  
**Backend base URL:** `https://api.pharmarelatorios.online`  
**Autenticação:** Bearer JWT em todos os endpoints (exceto onde indicado)

---

## 1. Visão Geral

Uma **Ação** representa uma campanha ou iniciativa de marketing executada em um mês específico (ex.: "Ação de Abre Mês — Junho/2026", "Promoção Dia dos Namorados"). Farmácias podem ser vinculadas a uma ou mais ações do mesmo mês, e a equipe da agência consegue visualizar de forma rápida **quais clientes estão participando de quê**.

### Conceitos-chave

| Entidade | Descrição |
|---|---|
| **Ação** | Campanha com nome, tipo, mês de referência, status e cor |
| **Participação** | Vínculo entre uma Farmácia e uma Ação (com observações opcionais) |
| **Mês de referência** | Formato `YYYY-MM` — cada ação pertence a um mês |

### Status de uma Ação

| Status | Cor sugerida | Significado |
|---|---|---|
| `planejada` | `#F59E0B` (amarelo) | Planejada mas ainda não iniciada |
| `em_andamento` | `#3B82F6` (azul) | Ativamente sendo executada |
| `concluida` | `#10B981` (verde) | Finalizada com sucesso |
| `cancelada` | `#EF4444` (vermelho) | Cancelada — não aparece nas listagens ativas |

### Tipos de Ação (sugestão de valores — o campo é livre)

| Tipo | Exemplo de nome |
|---|---|
| `abre_mes` | Ação de Abre Mês |
| `fecha_mes` | Ação de Fecha Mês |
| `campanha` | Campanha Dia das Mães |
| `promocao` | Promoção Semana da Saúde |
| `evento` | Live de Lançamento |
| `outro` | Ação personalizada |

---

## 2. Endpoints Disponíveis

### 2.1 Listar Ações

```
GET /api/acoes
```

**Query params (todos opcionais):**

| Parâmetro | Tipo | Descrição |
|---|---|---|
| `mes` | `YYYY-MM` | Filtra por mês de referência |
| `status` | string | Filtra por status (`planejada`, `em_andamento`, `concluida`, `cancelada`) |
| `tipo` | string | Filtra por tipo de ação |

**Resposta 200:**
```json
[
  {
    "id": 1,
    "nome": "Ação Abre Mês — Junho",
    "tipo": "abre_mes",
    "descricao": "Ação de captação de leads via Google Ads",
    "mes_referencia": "2026-06",
    "status": "em_andamento",
    "cor": "#3B82F6",
    "criado_por_id": 2,
    "criado_por_nome": "Ana Silva",
    "criado_em": "2026-06-01T10:00:00Z",
    "atualizado_em": "2026-06-01T10:00:00Z",
    "total_farmacias": 18
  }
]
```

---

### 2.2 Resumo do Mês (Dashboard de Ações)

```
GET /api/acoes/resumo?mes=2026-06
```

**Query params:**

| Parâmetro | Tipo | Descrição |
|---|---|---|
| `mes` | `YYYY-MM` | Mês desejado. Padrão: mês atual |

**Resposta 200:**
```json
{
  "mes": "2026-06",
  "total_acoes": 4,
  "farmacias_com_acao": 35,
  "por_status": {
    "planejadas": 1,
    "em_andamento": 2,
    "concluidas": 1,
    "canceladas": 0
  },
  "por_tipo": [
    { "tipo": "abre_mes",  "quantidade": 1 },
    { "tipo": "fecha_mes", "quantidade": 1 },
    { "tipo": "campanha",  "quantidade": 2 }
  ],
  "acoes": [
    {
      "id": 1,
      "nome": "Ação Abre Mês — Junho",
      "tipo": "abre_mes",
      "status": "em_andamento",
      "cor": "#3B82F6",
      "total_farmacias": 18
    }
  ]
}
```

---

### 2.3 Criar Ação *(somente admin)*

```
POST /api/acoes
Content-Type: application/json
Authorization: Bearer <token>
```

**Body:**
```json
{
  "nome": "Ação Abre Mês — Julho",
  "tipo": "abre_mes",
  "descricao": "Campanha de abertura de mês com foco em Google Ads",
  "mes_referencia": "2026-07",
  "status": "planejada",
  "cor": "#F59E0B"
}
```

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `nome` | string | Sim | Nome da ação (máx. 200 chars) |
| `tipo` | string | Sim | Tipo (máx. 80 chars) |
| `descricao` | string | Não | Descrição detalhada |
| `mes_referencia` | `YYYY-MM` | Sim | Mês ao qual a ação pertence |
| `status` | string | Não | Padrão: `planejada` |
| `cor` | string HEX | Não | Ex: `#3B82F6`. Para badge colorido na UI |

**Resposta 201:**
```json
{
  "id": 5,
  "nome": "Ação Abre Mês — Julho",
  "tipo": "abre_mes",
  "descricao": "Campanha de abertura de mês com foco em Google Ads",
  "mes_referencia": "2026-07",
  "status": "planejada",
  "cor": "#F59E0B",
  "criado_por_id": 1,
  "criado_em": "2026-06-02T14:00:00Z",
  "total_farmacias": 0
}
```

---

### 2.4 Detalhe de uma Ação (com lista de farmácias)

```
GET /api/acoes/:id
```

**Resposta 200:**
```json
{
  "id": 1,
  "nome": "Ação Abre Mês — Junho",
  "tipo": "abre_mes",
  "descricao": "...",
  "mes_referencia": "2026-06",
  "status": "em_andamento",
  "cor": "#3B82F6",
  "criado_por_id": 2,
  "criado_por_nome": "Ana Silva",
  "criado_em": "2026-06-01T10:00:00Z",
  "atualizado_em": "2026-06-01T10:00:00Z",
  "total_farmacias": 2,
  "farmacias": [
    {
      "participacao_id": 10,
      "farmacia_id": 7,
      "farmacia_nome": "Farmácia Central Ltda",
      "cidade": "São Paulo",
      "responsavel": "João Mendes",
      "telefone": "11999999999",
      "gestor_id": 3,
      "gestor_nome": "Carlos Oliveira",
      "nivel_alerta": "verde",
      "observacoes": "Cliente prioritário para esta ação",
      "adicionado_em": "2026-06-01T11:00:00Z"
    }
  ]
}
```

---

### 2.5 Editar Ação *(somente admin)*

```
PUT /api/acoes/:id
Content-Type: application/json
```

**Body (todos os campos são opcionais — envie apenas o que mudar):**
```json
{
  "nome": "Ação Abre Mês — Junho (Atualizada)",
  "status": "concluida",
  "cor": "#10B981"
}
```

**Resposta 200:** Retorna o objeto atualizado da ação.

---

### 2.6 Cancelar Ação *(somente admin)*

```
DELETE /api/acoes/:id
```

**Resposta 200:**
```json
{ "mensagem": "Ação cancelada.", "id": 1 }
```

> Nota: não exclui fisicamente — muda o status para `cancelada`. Pode ser reativada via `PUT`.

---

### 2.7 Adicionar Farmácias a uma Ação *(somente admin)*

```
POST /api/acoes/:id/farmacias
Content-Type: application/json
```

**Body:**
```json
{
  "farmacia_ids": [7, 12, 15, 23],
  "observacoes": "Clientes selecionados para campanha de Google Ads"
}
```

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `farmacia_ids` | `number[]` | Sim | Array de IDs de farmácias |
| `observacoes` | string | Não | Observação aplicada a todas as farmácias adicionadas |

**Resposta 201:**
```json
{
  "mensagem": "4 farmácia(s) adicionada(s) à ação.",
  "adicionadas": 4,
  "total_farmacias": 18
}
```

> Farmácias já vinculadas são ignoradas automaticamente (sem erro).

---

### 2.8 Remover Farmácia de uma Ação *(somente admin)*

```
DELETE /api/acoes/:id/farmacias/:farmaciaId
```

**Resposta 200:**
```json
{ "mensagem": "Farmácia removida da ação." }
```

---

### 2.9 Atualizar Observações de uma Farmácia na Ação *(somente admin)*

```
PATCH /api/acoes/:id/farmacias/:farmaciaId
Content-Type: application/json
```

**Body:**
```json
{ "observacoes": "Atualização: cliente confirmou participação." }
```

**Resposta 200:**
```json
{ "mensagem": "Observações atualizadas." }
```

---

### 2.10 Ações de uma Farmácia Específica

```
GET /api/farmacias/:id/acoes?mes=2026-06
```

**Query params:**

| Parâmetro | Tipo | Descrição |
|---|---|---|
| `mes` | `YYYY-MM` | Opcional — filtra por mês |

**Resposta 200:**
```json
[
  {
    "id": 1,
    "nome": "Ação Abre Mês — Junho",
    "tipo": "abre_mes",
    "descricao": "...",
    "mes_referencia": "2026-06",
    "status": "em_andamento",
    "cor": "#3B82F6",
    "criado_em": "2026-06-01T10:00:00Z",
    "observacoes": null,
    "adicionado_em": "2026-06-01T11:00:00Z"
  }
]
```

---

### 2.11 Campo `acoes_ativas` no GET /api/farmacias

O endpoint `GET /api/farmacias` agora retorna o campo `acoes_ativas` em cada farmácia:

```json
{
  "id": 7,
  "nome": "Farmácia Central Ltda",
  "nivel_alerta": "verde",
  "acoes_ativas": [
    {
      "id": 1,
      "nome": "Ação Abre Mês — Junho",
      "tipo": "abre_mes",
      "status": "em_andamento",
      "cor": "#3B82F6"
    },
    {
      "id": 3,
      "nome": "Campanha Dia dos Namorados",
      "tipo": "campanha",
      "status": "planejada",
      "cor": "#EC4899"
    }
  ]
}
```

> `acoes_ativas` contém apenas ações do **mês atual** com status diferente de `cancelada`. Array vazio `[]` se o cliente não tiver ação no mês.

---

## 3. Fluxos de Tela Sugeridos

### 3.1 Página de Ações (`/acoes`)

**Estrutura da página:**

```
┌─────────────────────────────────────────────────────────────┐
│  [← Ações de Marketing]       [+ Nova Ação]  [Mês: Jun/26] │
├───────────────────────────────────────────────────────────  │
│  KPIs do Mês:                                               │
│  ┌──────────┐ ┌───────────┐ ┌────────────┐ ┌────────────┐  │
│  │ 4 Ações  │ │35 Farms.  │ │2 Em Andto. │ │1 Concluída │  │
│  └──────────┘ └───────────┘ └────────────┘ └────────────┘  │
├─────────────────────────────────────────────────────────────│
│  Filtros: [Status ▾] [Tipo ▾]                               │
├─────────────────────────────────────────────────────────────│
│  ┌──────────────────────────────────────────────────────┐   │
│  │ [●AZUL] Ação Abre Mês — Junho    Em Andamento  18 🏪  │   │
│  │  Tipo: abre_mes                              [Editar] │   │
│  ├──────────────────────────────────────────────────────┤   │
│  │ [●AMR]  Ação Fecha Mês — Junho   Planejada    22 🏪   │   │
│  │  Tipo: fecha_mes                             [Editar] │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

**Comportamento:**
- Ao carregar: `GET /api/acoes/resumo` (KPIs) + `GET /api/acoes` (lista).
- Trocar mês no seletor: refaz ambas as chamadas com `?mes=YYYY-MM`.
- Clicar em uma ação: navega para `/acoes/:id`.
- Botão "+ Nova Ação": abre modal de criação.

---

### 3.2 Modal de Criação / Edição de Ação

**Campos do formulário:**

| Campo | Tipo de input | Validação |
|---|---|---|
| Nome | Text | Obrigatório |
| Tipo | Select ou text livre | Obrigatório |
| Mês de Referência | Month picker (`YYYY-MM`) | Obrigatório |
| Status | Select (4 opções) | Padrão: `planejada` |
| Cor | Color picker (HEX) | Opcional |
| Descrição | Textarea | Opcional |

**Ações do modal:**
- Criar: `POST /api/acoes`
- Editar: `PUT /api/acoes/:id`
- Cancelar ação: `DELETE /api/acoes/:id` (com confirmação)

---

### 3.3 Página de Detalhe da Ação (`/acoes/:id`)

```
┌─────────────────────────────────────────────────────────────┐
│  [← Voltar]   [●AZUL] Ação Abre Mês — Junho   [Editar]     │
│  Mês: Junho/2026 · Status: Em Andamento · 18 farmácias      │
├─────────────────────────────────────────────────────────────│
│  [+ Adicionar Farmácias]    [🔍 Buscar farmácia...]          │
├─────────────────────────────────────────────────────────────│
│  Farmácias Participantes:                                    │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ 🟢 Farmácia Central Ltda      SP · Gestor: Carlos      │ │
│  │    Obs: Cliente prioritário            [Editar] [✕ Rem] │ │
│  ├────────────────────────────────────────────────────────┤ │
│  │ 🟡 Farmácia Boa Saúde         RJ · Gestor: Maria       │ │
│  │    Obs: —                              [Editar] [✕ Rem] │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**Comportamento:**
- Ao carregar: `GET /api/acoes/:id`.
- "Remover" farmácia: `DELETE /api/acoes/:id/farmacias/:farmaciaId` com confirmação.
- "Editar obs." de uma farmácia: mini-modal com `PATCH /api/acoes/:id/farmacias/:farmaciaId`.
- "+ Adicionar Farmácias": abre modal de seleção múltipla (ver 3.4).

---

### 3.4 Modal de Adição de Farmácias

**Comportamento:**
1. Ao abrir: `GET /api/farmacias` para listar todas as farmácias ativas.
2. Mostrar lista com checkbox, busca por nome/cidade.
3. Farmácias já participantes da ação aparecem marcadas e desabilitadas.
4. Botão "Adicionar Selecionadas": `POST /api/acoes/:id/farmacias` com os IDs selecionados.

**Layout:**
```
┌──────────────────────────────────────┐
│  Adicionar Farmácias à Ação           │
│  [🔍 Buscar por nome ou cidade...]     │
├──────────────────────────────────────│
│  ☐  Farmácia Nova Saúde (SP)         │
│  ☑  Farmácia Central (já adicionada) │
│  ☐  Farmácia Bem Estar (RJ)          │
├──────────────────────────────────────│
│  [Cancelar]      [Adicionar 2 selecionadas] │
└──────────────────────────────────────┘
```

---

### 3.5 Badges de Ações na Listagem de Farmácias

Na tela de listagem de farmácias (`/farmacias`), exibir os badges de ações diretamente no card/linha de cada farmácia usando o campo `acoes_ativas`:

```
┌─────────────────────────────────────────────────────────────┐
│  🟢 Farmácia Central Ltda         SP  Carlos Oliveira       │
│  R$ 48.200  |  312 atend.  |  47 vendas                     │
│  [●AZUL Abre Mês] [●PINK Dia dos Namorados]                  │
└─────────────────────────────────────────────────────────────┘
```

**Regras dos badges:**
- Cor do badge: usar o campo `cor` da ação. Se `null`, usar cinza `#6B7280`.
- Apenas ações com `status != 'cancelada'` aparecem (já filtrado pelo backend).
- Ao clicar no badge: navegar para `/acoes/:id`.
- Tooltip no hover: mostrar `tipo` e `status` da ação.

---

### 3.6 Aba de Ações no Detalhe da Farmácia

Na página de detalhe de uma farmácia, adicionar uma aba "Ações":

```
[Resumo] [Evolução] [Reuniões] [Ações]
                                ^^^^^^
```

Ao clicar em "Ações":
- Chamar `GET /api/farmacias/:id/acoes` (sem filtro de mês para mostrar histórico).
- Exibir lista agrupada por mês com badges coloridos.

---

## 4. Paleta de Cores por Tipo (sugestão)

| Tipo | Cor HEX | Nome |
|---|---|---|
| `abre_mes` | `#3B82F6` | Azul |
| `fecha_mes` | `#8B5CF6` | Roxo |
| `campanha` | `#EC4899` | Rosa |
| `promocao` | `#F97316` | Laranja |
| `evento` | `#14B8A6` | Teal |
| `outro` | `#6B7280` | Cinza |

> O backend armazena a cor livremente como HEX. O frontend pode sugerir estas cores baseado no tipo selecionado, mas o admin pode sobrescrever.

---

## 5. Permissões por Perfil

| Operação | Admin | Gestor |
|---|---|---|
| Ver lista de ações | ✅ | ✅ |
| Ver resumo do mês | ✅ | ✅ |
| Ver detalhe da ação (com farmácias) | ✅ | ✅ |
| Criar ação | ✅ | ❌ |
| Editar ação | ✅ | ❌ |
| Cancelar ação | ✅ | ❌ |
| Adicionar farmácias a ação | ✅ | ❌ |
| Remover farmácia de ação | ✅ | ❌ |
| Ver ações da farmácia (detalhe) | ✅ | ✅ (só as suas) |
| Badges `acoes_ativas` na listagem | ✅ | ✅ |

---

## 6. Filtros Sugeridos na Listagem de Farmácias

Adicionar filtro "Somente com ação no mês" na tela de farmácias:

```
[Todos] [Com Ação] [Sem Ação] [Abre Mês] [Fecha Mês]
```

**Como implementar:** O campo `acoes_ativas` já vem no `GET /api/farmacias`. O filtro é **client-side**:
- "Com Ação": `acoes_ativas.length > 0`
- "Sem Ação": `acoes_ativas.length === 0`
- "Abre Mês": `acoes_ativas.some(a => a.tipo === 'abre_mes')`
- "Fecha Mês": `acoes_ativas.some(a => a.tipo === 'fecha_mes')`

---

## 7. Estados de Loading e Erro

| Situação | Comportamento esperado |
|---|---|
| Carregando lista de ações | Skeleton de 4 cards |
| Ação não encontrada (404) | Toast de erro + redirect para `/acoes` |
| Farmácia já adicionada | Ignorada silenciosamente (backend retorna sucesso) |
| Ação cancelada | Muda cor do badge para cinza com risco |
| Nenhuma ação no mês | Empty state com CTA "Criar primeira ação" |

---

## 8. Resumo dos Endpoints

| Método | Endpoint | Auth | Descrição |
|---|---|---|---|
| `GET` | `/api/acoes` | Todos | Lista ações com filtros |
| `GET` | `/api/acoes/resumo` | Todos | KPIs e resumo do mês |
| `POST` | `/api/acoes` | Admin | Criar nova ação |
| `GET` | `/api/acoes/:id` | Todos | Detalhe + farmácias |
| `PUT` | `/api/acoes/:id` | Admin | Editar ação |
| `DELETE` | `/api/acoes/:id` | Admin | Cancelar ação |
| `POST` | `/api/acoes/:id/farmacias` | Admin | Adicionar farmácias |
| `DELETE` | `/api/acoes/:id/farmacias/:farmaciaId` | Admin | Remover farmácia |
| `PATCH` | `/api/acoes/:id/farmacias/:farmaciaId` | Admin | Editar observações |
| `GET` | `/api/farmacias/:id/acoes` | Todos* | Ações de uma farmácia |
| `GET` | `/api/farmacias` | Todos | *(contém `acoes_ativas`)* |

*Gestor só acessa farmácias que ele gerencia.

---

## 9. Execução da Migration no Banco

Antes de publicar o frontend, rodar no banco de dados:

```bash
psql $DATABASE_URL -f migrations/0008_add_acoes.sql
```

Ou via Docker:
```bash
docker compose exec postgres psql -U farmacia -d farmacia_monitor -f /migrations/0008_add_acoes.sql
```
