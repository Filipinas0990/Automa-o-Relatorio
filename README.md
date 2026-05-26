# PharmaFlow — Automação de Relatórios Semanais

Sistema de coleta, processamento e visualização automática de dados de ~70 farmácias clientes de uma agência de marketing, via scraping do painel **PharmaChatBot**.

---

## O Problema

A agência atende ~70 farmácias, cada uma com um chatbot de atendimento integrado no **PharmaChatBot**. Toda semana, era necessário entrar manualmente em cada painel para identificar quais farmácias estavam com desempenho abaixo do esperado — um processo lento, manual e impossível de escalar.

## A Solução

Um pipeline 100% automatizado que:

1. **Entra automaticamente** no painel de cada farmácia todo domingo às 22h
2. **Coleta os dados** dos últimos 7, 15 e 30 dias
3. **Calcula um score de criticidade** comparando com a coleta anterior
4. **Salva tudo no banco de dados**
5. Na segunda de manhã, o **dashboard PharmaFlow** já reflete os dados atualizados

---

## Arquitetura

```
PostgreSQL (banco)
      │
      ▼
pipeline.ts — Pipeline (todo domingo 22h)
      │
      ├── Playwright → faz login em cada farmácia
      │               → coleta métricas dos períodos (7 / 15 / 30 dias)
      │               → extrai canais via React fiber (Recharts)
      │
      ├── Score Calculator → calcula criticidade vs coleta anterior
      │
      └── Drizzle ORM → salva histórico no PostgreSQL
                │
                ▼
           Fastify (API REST — porta 8000)
                │
                ▼
         PharmaFlow (Frontend Framer)
         front-end-ecru-two-48.vercel.app
```

---

## Métricas Coletadas por Farmácia

Extraídas do dashboard do PharmaChatBot para cada período (7, 15 e 30 dias):

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
| Scraper | Playwright (Chromium) |
| API | Fastify v4 + JWT + bcrypt |
| ORM | Drizzle ORM |
| Banco de dados | PostgreSQL 16 |
| Export | ExcelJS (XLSX) + CSV |
| Deploy | Docker + Docker Compose |
| Agendamento (VPS) | Cron Job Linux |
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
│       ├── scraper/
│       │   └── pharmachatbot.ts  # Playwright: login + filtro + extração
│       ├── processor/
│       │   └── score.ts          # cálculo de score de criticidade
│       ├── pipeline.ts           # entrypoint do scraper (docker)
│       ├── pipeline-fn.ts        # lógica principal do pipeline
│       ├── types.ts              # tipos compartilhados
│       ├── logger.ts             # pino logger
│       ├── cripto.ts             # encrypt/decrypt de senhas
│       └── transactions.ts
├── sql/
│   └── init.sql                  # schema, índices e views do banco
├── config/                       # credenciais e configurações (não commitar!)
├── logs/                         # logs do pipeline (montado via volume)
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

### Painel e Relatórios

| Endpoint | Descrição |
|---|---|
| `GET /api/painel` | KPIs gerais + canais agregados (`?dias=7\|15\|30`) |
| `GET /api/relatorios` | Lista de semanas com coletas |
| `GET /api/relatorios/:periodo/xlsx` | Download do relatório em Excel |
| `GET /api/relatorios/:periodo/csv` | Download do relatório em CSV (compatível Power BI) |
| `POST /api/rodar-agora` | Dispara o pipeline manualmente (admin) |
| `GET /api/status` | Verifica se o pipeline está rodando |

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
npx playwright install chromium
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

### 5. Rodar o pipeline manualmente

```bash
npm run pipeline
# ou via docker:
docker compose run --rm scraper
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

### Cron job (domingo 22h)

```bash
crontab -e
# adicione:
0 22 * * 0 cd /opt/pharmaflow && docker compose run --rm scraper >> /opt/pharmaflow/logs/cron.log 2>&1
```

### Verificar funcionamento

```bash
docker compose ps                    # containers ativos
docker compose logs -f api           # logs da API em tempo real
docker compose logs scraper          # logs da última execução do scraper
```

---

## Status do Projeto

| Fase | Descrição | Status |
|---|---|---|
| Coleta | Playwright: login + filtro + extração (7 / 15 / 30 dias) | ✅ Concluído |
| Processamento | Score de criticidade vs coleta anterior | ✅ Concluído |
| Banco de dados | PostgreSQL com schema, índices e views | ✅ Concluído |
| API | Fastify com todos os endpoints + export XLSX/CSV | ✅ Concluído |
| Autenticação | JWT + bcrypt + roles (admin / gestor) | ✅ Concluído |
| Ranking de Gestores | Pontuação mensal por metas atingidas | ✅ Concluído |
| Agendamento | Cron Linux (VPS) | ✅ Concluído |
| Deploy | Docker Compose (VPS) + Nginx + Let's Encrypt | ✅ Concluído |
| Frontend | PharmaFlow (Framer, integrado via API) | ✅ Existente |