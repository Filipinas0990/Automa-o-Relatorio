# PharmaFlow — Especificação de API para o Frontend

**Versão:** 2.0  
**Base URL:** `http://IP_DO_SERVIDOR:8000`  
**Gerado em:** Maio 2025

---

## Índice

1. [Autenticação](#1-autenticação)
2. [Regras de Acesso (Roles)](#2-regras-de-acesso-roles)
3. [Setup Inicial — Criar Super Admin](#3-setup-inicial--criar-super-admin)
4. [Login](#4-login)
5. [Painel Geral](#5-painel-geral)
6. [Farmácias — Listagem e Filtros](#6-farmácias--listagem-e-filtros)
7. [Farmácia — Detalhe e Evolução](#7-farmácia--detalhe-e-evolução)
8. [Farmácias — CRUD (Admin)](#8-farmácias--crud-admin)
9. [Gestores de Tráfego — CRUD (Admin)](#9-gestores-de-tráfego--crud-admin)
10. [Relatórios](#10-relatórios)
11. [Pipeline Manual](#11-pipeline-manual)
12. [Ranking de Gestores](#12-ranking-de-gestores)
13. [Tabela Resumo de Endpoints](#13-tabela-resumo-de-endpoints)
14. [Fluxo de Navegação](#14-fluxo-de-navegação)
15. [Tratamento de Erros](#15-tratamento-de-erros)

---

## 1. Autenticação

Após o login, o servidor retorna um **JWT token**. Esse token deve ser salvo no `localStorage` e enviado em **todas as requisições** (exceto login e setup) no header:

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

O token expira em **8 horas**. Quando qualquer chamada retornar `401`, redirecionar para `/login` e limpar o `localStorage`.

---

## 2. Regras de Acesso (Roles)

O login retorna o campo `is_admin` (boolean). O frontend deve usar esse valor para controlar o que cada usuário pode ver e fazer.

| Funcionalidade | Super Admin (`is_admin: true`) | Gestor (`is_admin: false`) |
|---|---|---|
| Painel com todas as farmácias | ✅ | ❌ Vê só as suas |
| Listar todas as farmácias | ✅ | ❌ Vê só as suas |
| Cadastrar farmácia | ✅ | ❌ |
| Editar / desativar farmácia | ✅ | ❌ |
| Cadastrar gestor | ✅ | ❌ |
| Editar / desativar gestor | ✅ | ❌ |
| Rodar pipeline manual | ✅ | ❌ |
| Ver relatórios e download Excel | ✅ | ✅ |
| Ver evolução de farmácia | ✅ | ✅ (só as suas) |

> **Nota:** A API já aplica o filtro automaticamente no servidor. O frontend não precisa passar `gestor_id` para o gestor comum — a API detecta pelo token e filtra sozinha.

---

## 3. Setup Inicial — Criar Super Admin

Essa tela/modal só deve aparecer **uma única vez**, quando ainda não existe nenhum admin. Após o primeiro admin ser criado, o endpoint fica permanentemente bloqueado.

### `POST /api/auth/criar-super-admin`

> **Autenticação:** Não requer JWT. Requer o `admin_secret` (segredo definido no servidor).

**Request Body (JSON):**
```json
{
  "nome": "João Silva",
  "email": "joao@agencia.com",
  "senha": "SuaSenhaForte123",
  "admin_secret": "segredo-definido-no-env-do-servidor"
}
```

**Resposta 201 — Sucesso:**
```json
{
  "id": 1,
  "nome": "João Silva",
  "email": "joao@agencia.com",
  "is_admin": true
}
```

**Erros possíveis:**
| Código | Motivo | Mensagem da API |
|---|---|---|
| `403` | Segredo incorreto | `"Segredo invalido"` |
| `409` | Já existe um admin | `"Super admin ja existe. Use o login normal."` |
| `503` | ADMIN_SECRET não configurado no servidor | `"ADMIN_SECRET nao configurado no servidor"` |

---

## 4. Login

### `POST /api/auth/login`

> **Autenticação:** Não requer JWT.  
> **Content-Type:** `application/x-www-form-urlencoded` (não JSON)

**Request Body (form):**
```
username=joao@agencia.com&password=SuaSenhaForte123
```

**Resposta 200 — Sucesso:**
```json
{
  "access_token": "eyJhbGci...",
  "token_type": "bearer",
  "id": 1,
  "nome": "João Silva",
  "email": "joao@agencia.com",
  "is_admin": true
}
```

**O que salvar no localStorage:**
```js
localStorage.setItem("token",    data.access_token)
localStorage.setItem("nome",     data.nome)
localStorage.setItem("id",       data.id)
localStorage.setItem("is_admin", data.is_admin)
```

**Erros possíveis:**
| Código | Motivo |
|---|---|
| `401` | Email ou senha incorretos |
| `403` | Usuário inativo |

---

### `GET /api/auth/me`

Retorna dados do usuário logado. Útil para validar o token na inicialização do app.

**Resposta 200:**
```json
{
  "id": 1,
  "nome": "João Silva",
  "email": "joao@agencia.com",
  "is_admin": true
}
```

---

## 5. Painel Geral

### `GET /api/painel`

> **Autenticação:** Requer JWT.  
> **Filtro automático:** Se o usuário for gestor (não admin), a API já filtra automaticamente pelas suas farmácias.

**Query params opcionais (somente para admin):**
- `?gestor_id=2` — Filtrar o painel pelo gestor selecionado

**Resposta 200:**
```json
{
  "receita_total": 980000.00,
  "total_atendimentos": 21400,
  "vendas_realizadas": 14200,
  "farmacias_ativas": 70,
  "farmacias_alerta": 8,
  "farmacias_atencao": 15,
  "taxa_conversao_media": 66.3,
  "ultima_atualizacao": "2025-05-11T22:10:00"
}
```

**Cards a exibir na tela:**

| Campo | Label | Formatação |
|---|---|---|
| `receita_total` | Receita Total | `R$ 980.000,00` |
| `total_atendimentos` | Total de Atendimentos | Número inteiro |
| `vendas_realizadas` | Vendas Realizadas | Número inteiro |
| `taxa_conversao_media` | Taxa de Conversão | `66.3%` |
| `farmacias_alerta` | Farmácias em Alerta | Badge vermelho |
| `farmacias_atencao` | Farmácias em Atenção | Badge amarelo |
| `ultima_atualizacao` | Última Atualização | `Dom, 11/05 às 22:10` |

**Dropdown de filtro por gestor (somente para admin):**  
Popular com `GET /api/gestores`. Ao mudar a seleção, refazer a chamada com `?gestor_id=X`.  
Opção "Todos" = chamar sem parâmetro.

---

## 6. Farmácias — Listagem e Filtros

### `GET /api/farmacias`

> **Autenticação:** Requer JWT.  
> **Filtro automático:** Gestor comum só vê as suas farmácias.

**Query params:**
| Parâmetro | Tipo | Descrição |
|---|---|---|
| `gestor_id` | integer | Filtrar por gestor (só admin usa) |
| `status` | string | `Ativa`, `Atencao` ou `Alerta` |
| `busca` | string | Busca por nome da farmácia |

**Resposta 200 — Array de farmácias:**
```json
[
  {
    "id": 1,
    "nome": "Farmácia Central Saúde",
    "status": "Alerta",
    "nivel_alerta": "vermelho",
    "gestor_id": 2,
    "receita_total": 15420.50,
    "total_atendimentos": 312,
    "atendimentos_finalizados": 280,
    "vendas_realizadas": 198,
    "taxa_conversao": 63.46,
    "variacao_receita": -12.3,
    "variacao_atendimentos": -5.1,
    "variacao_vendas": -8.5,
    "score_criticidade": 67.2,
    "posicao_ranking": 1,
    "periodo_inicio": "2025-05-05",
    "periodo_fim": "2025-05-11",
    "data_coleta": "2025-05-11T22:05:00"
  }
]
```

**Cor do badge por `nivel_alerta`:**
| Valor | Cor |
|---|---|
| `"verde"` | Verde |
| `"amarelo"` | Amarelo / Laranja |
| `"vermelho"` | Vermelho |

**Variações (`variacao_receita`, `variacao_vendas`, `variacao_atendimentos`):**
- Valor positivo → seta ▲ verde
- Valor negativo → seta ▼ vermelho
- Formatar como: `▲ 12.3%` ou `▼ 8.5%`

**Ao clicar na farmácia:** navegar para `/farmacias/:id`

---

## 7. Farmácia — Detalhe e Evolução

### `GET /api/farmacias/:id/evolucao`

> **Autenticação:** Requer JWT.  
> Gestor comum só pode ver farmácias que são suas (a API retorna `403` se tentar acessar outra).

**Resposta 200 — Array semanal (usar para gráficos):**
```json
[
  {
    "semana_numero": 1,
    "farmacia_id": 1,
    "receita_total": 14000.00,
    "total_atendimentos": 290,
    "atendimentos_finalizados": 260,
    "vendas_realizadas": 180,
    "score_criticidade": 45.0,
    "nivel_alerta": "amarelo",
    "variacao_receita": 0,
    "variacao_vendas": 0
  },
  {
    "semana_numero": 2,
    ...
  }
]
```

**Gráficos sugeridos:**
- Linha: Receita Total por semana
- Linha: Vendas Realizadas por semana
- Barra: Total de Atendimentos por semana
- Indicador: Score de Criticidade atual

---

## 8. Farmácias — CRUD (Admin)

> Todos os endpoints abaixo exigem **`is_admin: true`**. A API retorna `403` se um gestor comum tentar usar.

### Criar farmácia — `POST /api/farmacias`

**Request Body (JSON):**
```json
{
  "nome": "Farmácia Nova Esperança",
  "url_base": "https://app13.pharmachatbot.com.br/nova-esperanca",
  "email": "login@novaesperanca.com",
  "senha": "senhaDoPharmaChatBot",
  "gestor_id": 2
}
```

> ⚠️ A `senha` aqui é a senha de acesso ao PharmaChatBot da farmácia, não a senha do gestor.  
> O campo `gestor_id` é opcional. Se não informado, a farmácia fica sem gestor vinculado.

**Resposta 201:**
```json
{ "id": 15, "nome": "Farmácia Nova Esperança", "gestor_id": 2 }
```

---

### Editar farmácia — `PUT /api/farmacias/:id`

Todos os campos são **opcionais**. Enviar apenas o que foi alterado.  
**Não enviar `senha` se o usuário deixou o campo vazio** — isso evita sobrescrever a senha existente.

**Request Body (JSON):**
```json
{
  "nome": "Novo Nome da Farmácia",
  "gestor_id": 3,
  "ativa": true
}
```

**Resposta 200:**
```json
{ "id": 15, "nome": "Novo Nome da Farmácia", "ativa": true }
```

---

### Desativar farmácia — `DELETE /api/farmacias/:id`

Soft delete — a farmácia some das listagens mas os dados históricos são preservados.

**Resposta 200:**
```json
{ "mensagem": "Farmacia desativada" }
```

---

## 9. Gestores de Tráfego — CRUD (Admin)

> Listar gestores: qualquer usuário logado pode.  
> Criar / Editar / Deletar: **somente admin**.

### Listar gestores — `GET /api/gestores`

**Resposta 200:**
```json
[
  {
    "id": 1,
    "nome": "João Silva",
    "email": "joao@agencia.com",
    "is_admin": true,
    "criado_em": "2025-05-01T10:00:00",
    "farmacias": 0
  },
  {
    "id": 2,
    "nome": "Maria Santos",
    "email": "maria@agencia.com",
    "is_admin": false,
    "criado_em": "2025-05-02T14:30:00",
    "farmacias": 12
  }
]
```

O campo `farmacias` indica quantas farmácias ativas estão vinculadas ao gestor.

---

### Criar gestor — `POST /api/gestores`

**Request Body (JSON):**
```json
{
  "nome": "Carlos Pereira",
  "email": "carlos@agencia.com",
  "senha": "SenhaSegura456"
}
```

**Resposta 201:**
```json
{ "id": 3, "nome": "Carlos Pereira", "email": "carlos@agencia.com" }
```

**Erro 409:** Email já cadastrado.

> Gestores criados via essa rota **nunca** são admin (`is_admin` é sempre `false`). Só existe um super admin, criado pelo endpoint de setup.

---

### Editar gestor — `PUT /api/gestores/:id`

Todos os campos são **opcionais**.  
**Não enviar `senha` se o usuário deixou o campo vazio.**

**Request Body (JSON):**
```json
{
  "nome": "Carlos P. Atualizado",
  "email": "carlos.novo@agencia.com",
  "senha": "NovaSenha789"
}
```

**Resposta 200:**
```json
{ "id": 3, "nome": "Carlos P. Atualizado", "email": "carlos.novo@agencia.com" }
```

---

### Desativar gestor — `DELETE /api/gestores/:id`

**Resposta 200:**
```json
{ "mensagem": "Gestor desativado" }
```

**Erro 400:** Se o admin tentar deletar a si mesmo.

---

## 10. Relatórios

### Listar execuções — `GET /api/relatorios`

> **Autenticação:** Requer JWT (qualquer usuário logado).

**Resposta 200:**
```json
[
  {
    "id": 1,
    "label": "Semana 12 — 05 Mai a 11 Mai",
    "periodo_inicio": "2025-05-05",
    "periodo_fim": "2025-05-11",
    "data_geracao": "2025-05-11T22:15:00",
    "farmacias": "70/70",
    "status": "Concluido"
  }
]
```

**Badge de status:**
| Valor | Cor |
|---|---|
| `"Concluido"` | Verde |
| `"Parcial"` | Amarelo |
| `"Erro"` | Vermelho |

---

### Download Excel — `GET /api/relatorios/:periodo_inicio/xlsx`

> **Autenticação:** Requer JWT.

Exemplo de URL: `GET /api/relatorios/2025-05-05/xlsx`

**Como fazer o download no frontend:**
```js
// Opção 1 — abrir em nova aba
window.open(`${BASE_URL}/api/relatorios/2025-05-05/xlsx`)

// Opção 2 — download direto com fetch
const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
const blob = await response.blob()
const link = document.createElement('a')
link.href = URL.createObjectURL(blob)
link.download = 'relatorio_2025-05-05.xlsx'
link.click()
```

---

## 11. Pipeline Manual

### Disparar coleta — `POST /api/rodar-agora`

> **Autenticação:** Requer JWT de **admin**.

Inicia a coleta de todas as farmácias em background. Retorna imediatamente.

**Resposta 200 — Pipeline iniciado:**
```json
{ "status": "iniciado", "mensagem": "Pipeline iniciado em background" }
```

**Resposta 200 — Já estava rodando:**
```json
{ "status": "ja_rodando", "mensagem": "Pipeline ja esta em execucao" }
```

---

### Verificar status — `GET /api/status`

> **Autenticação:** Não requer JWT.

```json
{ "pipeline_rodando": true, "timestamp": "2025-05-13T10:05:00" }
```

**Polling para acompanhar o progresso:**
```js
// Após clicar em "Rodar Agora", fazer polling a cada 5 segundos
const intervalo = setInterval(async () => {
  const res = await fetch(`${BASE_URL}/api/status`)
  const data = await res.json()
  if (!data.pipeline_rodando) {
    clearInterval(intervalo)
    // Mostrar: "Coleta finalizada! Atualize a página."
  }
}, 5000)
```

---

## 12. Ranking de Gestores

> **Autenticação:** Requer JWT (qualquer usuário logado).

### Regras de negócio

- **1 ponto = 1 coleta em que a farmácia atingiu a meta** de vendas e/ou receita
- Os pontos **acumulam a cada rodada semanal** dentro do mesmo mês
- **No dia 1 de cada mês os pontos zeram automaticamente** — não há ação necessária no frontend, a API já retorna 0 para todos no início do mês
- Gestores sem nenhuma coleta no mês aparecem no final da lista com `pontos: 0`
- Coletas históricas são preservadas — é possível consultar qualquer mês passado

---

### Ranking do mês atual — `GET /api/ranking/gestores`

**Query params opcionais:**

| Parâmetro | Tipo   | Descrição                                | Exemplo         |
|-----------|--------|------------------------------------------|-----------------|
| `mes`     | string | Mês no formato `YYYY-MM`. Padrão: atual  | `?mes=2026-04`  |

**Resposta 200:**
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

**Campos:**

| Campo                  | Tipo   | Descrição                                                                   |
|------------------------|--------|-----------------------------------------------------------------------------|
| `posicao`              | int    | Posição no ranking — 1 = melhor do mês                                      |
| `gestor_id`            | int    | ID do gestor                                                                |
| `gestor_nome`          | string | Nome do gestor                                                              |
| `pontos`               | int    | Pontos acumulados no mês                                                    |
| `total_farmacias`      | int    | Total de farmácias ativas vinculadas ao gestor                              |
| `farmacias_com_coleta` | int    | Farmácias que tiveram ao menos 1 coleta no mês                              |
| `coletas_no_mes`       | int    | Total de rodadas de coleta realizadas no mês para as farmácias desse gestor |
| `taxa_acerto`          | float  | `pontos / coletas_no_mes × 100` — percentual de coletas que bateram a meta  |
| `mes`                  | string | Mês de referência no formato `YYYY-MM`                                      |

**Seletor de mês histórico:**
```js
// Popular dropdown com os últimos 6 meses (gerar no frontend)
function gerarMeses(n = 6) {
  const meses = []
  const agora = new Date()
  for (let i = 0; i < n; i++) {
    const d = new Date(agora.getFullYear(), agora.getMonth() - i, 1)
    meses.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return meses  // ["2026-05", "2026-04", "2026-03", ...]
}

// Ao mudar a seleção:
const res = await fetch(`${BASE_URL}/api/ranking/gestores?mes=${mesSelecionado}`, {
  headers: { Authorization: `Bearer ${token}` }
})
```

---

### Histórico dos últimos 6 meses — `GET /api/ranking/gestores/historico`

Retorna uma lista plana com pontos por gestor por mês. Ideal para gráfico de evolução.

**Resposta 200:**
```json
[
  { "gestor_id": 3, "gestor_nome": "Carlos Souza", "mes": "2026-05", "pontos": 8,  "coletas_no_mes": 12 },
  { "gestor_id": 1, "gestor_nome": "Ana Lima",     "mes": "2026-05", "pontos": 5,  "coletas_no_mes": 9  },
  { "gestor_id": 3, "gestor_nome": "Carlos Souza", "mes": "2026-04", "pontos": 11, "coletas_no_mes": 16 },
  { "gestor_id": 1, "gestor_nome": "Ana Lima",     "mes": "2026-04", "pontos": 3,  "coletas_no_mes": 8  }
]
```

> **Atenção:** Os dados vêm ordenados por `mes DESC`. Para um gráfico de linha, agrupar por `gestor_id` e ordenar por `mes ASC` no cliente.

**Exemplo de transformação para gráfico:**
```js
// Agrupa por gestor e ordena por mês crescente
function transformarParaGrafico(dados) {
  const porGestor = {}
  dados.forEach(({ gestor_id, gestor_nome, mes, pontos }) => {
    if (!porGestor[gestor_id]) porGestor[gestor_id] = { nome: gestor_nome, serie: [] }
    porGestor[gestor_id].serie.push({ mes, pontos })
  })
  Object.values(porGestor).forEach(g => g.serie.sort((a, b) => a.mes.localeCompare(b.mes)))
  return Object.values(porGestor)
}
// Retorna: [{ nome: "Carlos", serie: [{mes:"2026-03",pontos:5}, {mes:"2026-04",pontos:11}, ...] }, ...]
```

---

### Rota sugerida

```
/ranking-gestores    → Ranking do mês atual + seletor de mês + gráfico de evolução
```

**Quem pode ver:**
- Admin: vê todos os gestores
- Gestor comum: vê apenas a sua própria posição no ranking

> **Nota:** O endpoint já filtra pela role automaticamente via token JWT — sem parâmetro extra necessário para o gestor comum.

---

## 13. Tabela Resumo de Endpoints

| Método | Endpoint | Auth | Admin? | Descrição |
|---|---|---|---|---|
| `POST` | `/api/auth/criar-super-admin` | ❌ | Requer `admin_secret` | Criar super admin (uma vez) |
| `POST` | `/api/auth/login` | ❌ | — | Login |
| `GET` | `/api/auth/me` | ✅ | — | Dados do usuário logado |
| `GET` | `/api/painel` | ✅ | — | Cards do painel |
| `GET` | `/api/farmacias` | ✅ | — | Listar farmácias |
| `POST` | `/api/farmacias` | ✅ | ✅ | Cadastrar farmácia |
| `PUT` | `/api/farmacias/:id` | ✅ | ✅ | Editar farmácia |
| `DELETE` | `/api/farmacias/:id` | ✅ | ✅ | Desativar farmácia |
| `GET` | `/api/farmacias/:id/evolucao` | ✅ | — | Histórico semanal |
| `GET` | `/api/gestores` | ✅ | — | Listar gestores |
| `POST` | `/api/gestores` | ✅ | ✅ | Cadastrar gestor |
| `PUT` | `/api/gestores/:id` | ✅ | ✅ | Editar gestor |
| `DELETE` | `/api/gestores/:id` | ✅ | ✅ | Desativar gestor |
| `GET` | `/api/relatorios` | ✅ | — | Listar relatórios |
| `GET` | `/api/relatorios/:data/xlsx` | ✅ | — | Download Excel |
| `POST` | `/api/rodar-agora` | ✅ | ✅ | Disparar pipeline |
| `GET` | `/api/status` | ❌ | — | Status do pipeline |
| `GET` | `/api/ranking/gestores` | ✅ | — | Ranking mensal de gestores |
| `GET` | `/api/ranking/gestores/historico` | ✅ | — | Evolução últimos 6 meses |

---

## 14. Fluxo de Navegação

```
/setup               → Criar super admin (uma única vez)
/login               → Login
/painel              → Painel geral com cards e lista de farmácias
/farmacias           → Lista completa com filtros
/farmacias/:id       → Detalhe e gráficos de evolução
/farmacias/novo      → Formulário de cadastro (admin)
/farmacias/:id/editar → Formulário de edição (admin)
/gestores            → Lista de gestores (admin)
/gestores/novo       → Formulário de cadastro (admin)
/gestores/:id/editar → Formulário de edição (admin)
/relatorios          → Lista de relatórios + download Excel
/ranking-gestores    → Ranking mensal de gestores + gráfico de evolução
```

**Proteção de rotas:**
- Qualquer rota (exceto `/login` e `/setup`) → verificar se há token válido
- Se não houver token → redirecionar para `/login`
- Se `is_admin = false` → esconder botões e menus de admin; exibir apenas conteúdo do próprio gestor

---

## 15. Tratamento de Erros

Todos os erros seguem o formato:
```json
{ "detail": "Mensagem de erro aqui" }
```

**Tabela de status HTTP:**
| Código | Significado | O que fazer no frontend |
|---|---|---|
| `200` | Sucesso | Processar resposta normalmente |
| `201` | Criado com sucesso | Mostrar mensagem de sucesso, atualizar lista |
| `400` | Dados inválidos | Mostrar `detail` para o usuário |
| `401` | Não autenticado / token expirado | Limpar localStorage, redirecionar para `/login` |
| `403` | Sem permissão | Mostrar "Acesso negado" |
| `404` | Recurso não encontrado | Mostrar "Não encontrado" |
| `409` | Conflito (ex: email duplicado) | Mostrar `detail` para o usuário |
| `422` | Campos obrigatórios faltando | Validar formulário antes de enviar |
| `500` | Erro interno do servidor | Mostrar "Erro no servidor, tente novamente" |

---

*Documento gerado automaticamente pelo Claude Code — PharmaFlow Backend v2*
