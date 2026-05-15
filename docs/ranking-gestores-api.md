# Ranking de Gestores — Documentação de API

**Versão:** v5 (migration_v5.sql)
**Base URL:** `https://api.pharmarelatorios.online`

---

## Contexto e regras de negócio

### O que são pontos?

Cada vez que o scraper roda (semanalmente), ele verifica se cada farmácia atingiu sua meta de vendas e/ou receita.

- **Farmácia atingiu a meta** → o gestor responsável ganha **+1 ponto**
- **Farmácia não atingiu** → 0 pontos nessa rodada

Os pontos **acumulam dentro do mês**. Se o gestor tem 3 farmácias e todas batem a meta em 4 rodadas mensais, ele termina o mês com até 12 pontos.

### Reset mensal automático

No dia 1 de cada mês, os pontos voltam a zero **automaticamente** — não há cron job, o sistema simplesmente conta apenas as coletas do mês atual. Na virada do mês, nenhuma coleta do novo mês existe ainda, então todos partem do zero.

### Coletas históricas

Os dados de meses anteriores são preservados. É possível consultar qualquer mês passado pelo parâmetro `?mes=YYYY-MM`.

---

## Endpoints

### 1. Ranking do mês atual

```
GET /api/ranking/gestores
Authorization: Bearer {token}
```

Retorna o ranking de todos os gestores ativos ordenado por pontos no mês corrente. Gestores sem nenhuma coleta no mês aparecem no final com `pontos: 0`.

**Query params opcionais:**

| Parâmetro | Tipo   | Descrição                               | Exemplo       |
|-----------|--------|-----------------------------------------|---------------|
| `mes`     | string | Mês no formato `YYYY-MM`. Padrão: atual | `?mes=2026-04` |

**Exemplo de request:**
```
GET /api/ranking/gestores
GET /api/ranking/gestores?mes=2026-04
```

**Exemplo de resposta:**
```json
[
  {
    "posicao": 1,
    "gestor_id": 3,
    "gestor_nome": "Carlos Souza",
    "pontos": 8,
    "total_farmacias": 4,
    "farmacias_com_coleta": 4,
    "coletas_no_mes": 12,
    "taxa_acerto": 66.7,
    "mes": "2026-05"
  },
  {
    "posicao": 2,
    "gestor_id": 1,
    "gestor_nome": "Ana Lima",
    "pontos": 5,
    "total_farmacias": 3,
    "farmacias_com_coleta": 3,
    "coletas_no_mes": 9,
    "taxa_acerto": 55.6,
    "mes": "2026-05"
  },
  {
    "posicao": 3,
    "gestor_id": 7,
    "gestor_nome": "João Pedro",
    "pontos": 0,
    "total_farmacias": 2,
    "farmacias_com_coleta": 0,
    "coletas_no_mes": 0,
    "taxa_acerto": 0.0,
    "mes": "2026-05"
  }
]
```

**Campos da resposta:**

| Campo                 | Tipo    | Descrição                                                             |
|-----------------------|---------|-----------------------------------------------------------------------|
| `posicao`             | int     | Posição no ranking (1 = melhor)                                       |
| `gestor_id`           | int     | ID do gestor                                                          |
| `gestor_nome`         | string  | Nome do gestor                                                        |
| `pontos`              | int     | Pontos acumulados no mês (1 por coleta onde farmácia bateu a meta)   |
| `total_farmacias`     | int     | Total de farmácias ativas vinculadas ao gestor                        |
| `farmacias_com_coleta`| int     | Farmácias que tiveram ao menos 1 coleta no mês                       |
| `coletas_no_mes`      | int     | Total de coletas realizadas no mês para as farmácias desse gestor    |
| `taxa_acerto`         | float   | `pontos / coletas_no_mes * 100` — % das coletas que bateram a meta  |
| `mes`                 | string  | Mês de referência no formato `YYYY-MM`                               |

---

### 2. Histórico dos últimos 6 meses

```
GET /api/ranking/gestores/historico
Authorization: Bearer {token}
```

Retorna uma lista flat com pontos por gestor por mês dos últimos 6 meses. Ideal para renderizar um gráfico de barras ou linhas de evolução.

**Exemplo de resposta:**
```json
[
  { "gestor_id": 3, "gestor_nome": "Carlos Souza", "mes": "2026-05", "pontos": 8,  "coletas_no_mes": 12 },
  { "gestor_id": 1, "gestor_nome": "Ana Lima",     "mes": "2026-05", "pontos": 5,  "coletas_no_mes": 9  },
  { "gestor_id": 3, "gestor_nome": "Carlos Souza", "mes": "2026-04", "pontos": 11, "coletas_no_mes": 16 },
  { "gestor_id": 1, "gestor_nome": "Ana Lima",     "mes": "2026-04", "pontos": 3,  "coletas_no_mes": 8  }
]
```

> **Atenção frontend:** Os dados vêm em ordem `mes DESC, pontos DESC`. Para montar um gráfico de linha por gestor, agrupe por `gestor_id` e ordene por `mes ASC` no cliente.

---

## Como o frontend deve exibir

### Tela de Ranking (mês atual)

- Consumir `GET /api/ranking/gestores` sem parâmetro
- Ordenação já vem pronta pelo servidor (`posicao`)
- Exibir `posicao`, `gestor_nome`, `pontos`, `taxa_acerto`
- Badge ou progresso visual com `taxa_acerto` (0–100%)
- Gestores com `coletas_no_mes = 0` podem receber um indicador "Sem dados no mês"

### Seletor de mês histórico

- Passar `?mes=YYYY-MM` para consultar meses anteriores
- Sugestão: dropdown com os últimos 6 meses (gerar no frontend ou buscar do histórico)

### Gráfico de evolução

- Consumir `GET /api/ranking/gestores/historico`
- Agrupar por `gestor_id`, ordenar por `mes ASC`
- Renderizar linha por gestor com pontos no eixo Y e mês no eixo X

---

## Autenticação

Todos os endpoints exigem token JWT no header:

```
Authorization: Bearer {access_token}
```

O token é obtido em `POST /api/auth/login`.

---

## Como aplicar a migration no servidor

```bash
docker compose exec postgres psql -U farmacia -d farmacia_monitor -f /app/sql/migration_v5.sql
```

A migration:
1. Adiciona coluna `atingiu_meta BOOLEAN DEFAULT FALSE` na tabela `coletas`
2. Cria a view `vw_pontos_gestor_mensal`
3. Cria a view auxiliar `vw_ranking_gestores_atual`

Coletas anteriores à migration ficam com `atingiu_meta = FALSE` (padrão conservador). Os pontos históricos reais serão contabilizados a partir da próxima rodada do scraper.

---

## Resumo das mudanças no banco

| Objeto                      | Tipo   | O que mudou                                          |
|-----------------------------|--------|------------------------------------------------------|
| `coletas.atingiu_meta`      | coluna | Nova coluna boolean — gravada a cada coleta          |
| `vw_pontos_gestor_mensal`   | view   | Pontos por gestor por mês derivados de `atingiu_meta`|
| `vw_ranking_gestores_atual` | view   | Atalho para `vw_pontos_gestor_mensal` do mês atual   |
