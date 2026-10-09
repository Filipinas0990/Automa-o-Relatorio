# PharmaFlow

Sistema de acompanhamento de ~70 farmácias clientes de uma agência de marketing que usam o **PharmaChatBot**.

> **Coleta de dados em transição.** O robô (Playwright) que fazia login no painel de cada farmácia e lia os números da tela foi removido. Os dados vão chegar pela API do PharmaChatBot, que ainda não existe. Até lá, as telas mostram as últimas coletas gravadas no banco.

---

## O Problema

A agência atende ~70 farmácias, cada uma com um chatbot de atendimento integrado no **PharmaChatBot**. Toda semana, era necessário entrar manualmente em cada painel para identificar quais farmácias estavam com desempenho abaixo do esperado — um processo lento, manual e impossível de escalar.

## A Solução

1. **Recebe os dados** de cada farmácia nos períodos de 7, 15 e 30 dias (hoje: tabelas `coletas` e `coleta_canais`; no futuro: API do PharmaChatBot)
2. **Calcula um score de criticidade** comparando com a coleta anterior (`src/processor/score.ts`)
3. O **dashboard PharmaFlow** mostra ranking, alertas e metas

---

## Arquitetura

```
API do PharmaChatBot (a construir)
      │
      ▼
ingestão (a construir) ── score.ts → calcula criticidade vs coleta anterior
      │
      ▼
PostgreSQL (coletas, coleta_canais, views)
      │
      ▼
Fastify (API REST — porta 8000)
      │
      ▼
PharmaFlow (frontend)
```

---

## Métricas Coletadas por Farmácia

Gravadas por período (7, 15 e 30 dias):

| Métrica | Descrição |
|---|---|
| **Clientes Google** | Leads originados do Google |
| **Clientes Facebook/Meta** | Leads originados do Meta |
| **Clientes Grupos de Oferta** | Leads originados de grupos |
| **Total de atendimentos** | Total de conversas iniciadas |
| **Vendas realizadas** | Pedidos convertidos |
| **Receita total** | Faturamento gerado pelo chatbot |
| **Canais** | Breakdown por canal (pizza chart via React fiber) |

### Score de Criticidade (0–100)

Calculado automaticamente comparando com a coleta anterior do mesmo período:

**Níveis de alerta:** Verde (baixo risco) · Amarelo (atenção) · Vermelho (50+ ou meta não atingida)

### Metas por Farmácia

Cada farmácia pode ter metas individuais configuradas:

| Meta | Campo |
|---|---|
| Meta de receita (R$) | `meta_receita` |
| Meta de vendas | `meta_vendas` |
| Meta de leads Google | `meta_leads_google` |
| Meta de leads Meta | `meta_leads_meta` |

---

## Stack Tecnológica

| Camada | Tecnologia |
|---|---|
| Runtime | Node.js + TypeScript |
| API | Fastify v4 + JWT + bcrypt |
| ORM | Drizzle ORM |
| Banco de dados | PostgreSQL 16 |
| Deploy | Docker + Docker Compose |
| Frontend | Framer (externo, integrado via API) |
| Domínio API | api.pharmarelatorios.online (Nginx + Let's Encrypt) |

---

## Estrutura do Projeto

```
AUTOMAÇÂO/
├── pharmaflow-node/
│   └── src/
│       ├── api/
│       │   └── index.ts          # Fastify: todos os endpoints REST
│       ├── database/
│       │   ├── db.ts             # conexão Drizzle + pg
│       │   └── schema.ts         # tabelas e views (Drizzle schema)
│       ├── processor/
│       │   └── score.ts          # cálculo de score de criticidade
│       ├── types.ts              # tipos da regra de score
│       ├── logger.ts             # pino logger
│       ├── cripto.ts             # encrypt/decrypt de tokens
│       └── transactions.ts
├── sql/
│   └── init.sql                  # schema, índices e views do banco
├── config/                       # credenciais e configurações (não commitar!)
├── logs/                         # logs da API (montado via volume)
├── docker-compose.yml
└── .env.example
```

---

## Banco de Dados

### Tabelas

| Tabela | Descrição |
|---|---|
| `gestores_trafego` | Usuários gestores (login, JWT, admin flag) |
| `farmacias` | Cadastro das farmácias com credenciais criptografadas e metas |
| `coletas` | Métricas semanais + score por farmácia e período |
| `coleta_canais` | Breakdown de atendimentos/vendas por canal de marketing |

### Views

| View | Descrição |
|---|---|
| `vw_ranking_atual` | Última coleta de cada farmácia com posição de ranking |
| `vw_evolucao_semanal` | Histórico por farmácia para gráfico de evolução |

---

## API REST (Fastify)

### Auth

| Endpoint | Descrição |
|---|---|
| `POST /api/auth/login` | Login — retorna JWT (8h) |
| `GET /api/auth/me` | Dados do usuário autenticado |
| `POST /api/auth/criar-super-admin` | Cria o primeiro admin (requer `ADMIN_SECRET`) |

### Gestores

| Endpoint | Descrição |
|---|---|
| `GET /api/gestores` | Lista gestores com contagem de farmácias |
| `POST /api/gestores` | Cria gestor (admin) |
| `PUT /api/gestores/:id` | Edita gestor (admin) |
| `DELETE /api/gestores/:id` | Desativa gestor (admin) |

### Farmácias

| Endpoint | Descrição |
|---|---|
| `GET /api/farmacias` | Lista farmácias com métricas e canais (`?dias=7\|15\|30`) |
| `POST /api/farmacias` | Cadastra farmácia (admin) |
| `PUT /api/farmacias/:id` | Edita farmácia (admin) |
| `PATCH /api/farmacias/:id/meta` | Atualiza metas da farmácia (admin) |
| `DELETE /api/farmacias/:id` | Desativa farmácia (admin) |
| `GET /api/farmacias/:id/evolucao` | Histórico semanal de uma farmácia |

### Painel

| Endpoint | Descrição |
|---|---|
| `GET /api/painel` | KPIs gerais + canais agregados (`?dias=7\|15\|30`) |

### Ranking de Gestores

| Endpoint | Descrição |
|---|---|
| `GET /api/ranking/gestores` | Ranking mensal de gestores por pontos de meta (`?mes=YYYY-MM`) |
| `GET /api/ranking/gestores/historico` | Histórico de pontos dos últimos 6 meses |

---

## Como Rodar Localmente

### Pré-requisitos

- Node.js 20+
- Docker Desktop

### 1. Instalar dependências

```bash
cd pharmaflow-node
npm install
```

### 2. Configurar variáveis de ambiente

```bash
copy .env.example .env
# edite o .env com DATABASE_URL, JWT_SECRET_KEY, ADMIN_SECRET, CRYPT_KEY
```

### 3. Subir o banco de dados

```bash
docker compose up postgres -d
```

### 4. Compilar e rodar a API

```bash
npm run build
npm start
# ou em modo dev:
npm run dev
```

---

## Deploy na VPS (Linux)

```bash
# 1. Envie o projeto para a VPS
scp -r . root@IP_DA_VPS:/opt/pharmaflow

# 2. Acesse a VPS e suba os containers
ssh root@IP_DA_VPS
cd /opt/pharmaflow
docker compose up -d --build
```

### Verificar funcionamento

```bash
docker compose ps                    # containers ativos
docker compose logs -f api           # logs da API em tempo real
```

---

## Status do Projeto

| Fase | Descrição | Status |
|---|---|---|
| Coleta | Via API do PharmaChatBot (robô Playwright removido) | ⏳ Aguardando API |
| Processamento | Score de criticidade vs coleta anterior | ✅ Concluído |
| Banco de dados | PostgreSQL com schema, índices e views | ✅ Concluído |
| API | Fastify com todos os endpoints | ✅ Concluído |
| Autenticação | JWT + bcrypt + roles (admin / gestor) | ✅ Concluído |
| Ranking de Gestores | Pontuação mensal por metas atingidas | ✅ Concluído |
| Deploy | Docker Compose (VPS) + Nginx + Let's Encrypt | ✅ Concluído |
| Frontend | PharmaFlow (Framer, integrado via API) | ✅ Existente |