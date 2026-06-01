# Spec: Clientes de Entrada — PharmaFlow Frontend

## Contexto

O sistema agora suporta dois tipos de farmácia:

| fase       | Descrição                                                                 |
|------------|---------------------------------------------------------------------------|
| `entrada`  | Cliente novo. Ainda sem credenciais da plataforma PharmaChatBot.          |
| `ativo`    | Cliente com URL + login configurados. Aparece no scraping e no ranking.   |

O fluxo é:
1. Admin cadastra cliente com `fase: 'entrada'` (só dados básicos de contato).
2. Admin atribui a um gestor (`PUT /api/farmacias/:id`).
3. Admin ativa o cliente (`PATCH /api/farmacias/:id/ativar`) fornecendo URL + email + senha da plataforma.
4. A partir daí, o cliente entra no pipeline de scraping normalmente.

---

## Novos campos na entidade Farmácia

Todos os clientes (entrada e ativos) agora retornam estes campos extras em `GET /api/farmacias`:

```ts
{
  fase:        'entrada' | 'ativo'   // novo — identifica o tipo de cliente
  telefone:    string | null          // novo — WhatsApp/telefone do responsável
  responsavel: string | null          // novo — nome do dono ou gerente
  cidade:      string | null          // novo — cidade da farmácia
  // (observacoes existe no banco mas não é retornado na listagem)
}
```

Os demais campos (`id`, `nome`, `status`, `nivel_alerta`, `gestor_id`, `tem_chatbot`, etc.) continuam iguais.

---

## API — Referência completa

### 1. Listar farmácias — `GET /api/farmacias`

Igual ao anterior, mas agora aceita filtro extra e retorna os novos campos.

**Query params novos:**
- `?fase=entrada` → retorna só clientes de entrada
- `?fase=ativo` → retorna só clientes ativos (equivale ao comportamento anterior sem o filtro)

**Response (cada item):**
```json
{
  "id": 42,
  "nome": "Farmácia Central",
  "fase": "entrada",
  "status": "Ativa",
  "nivel_alerta": "verde",
  "gestor_id": null,
  "telefone": "(11) 99999-1234",
  "responsavel": "João Silva",
  "cidade": "São Paulo",
  "tem_chatbot": true,
  "receita_total": 0,
  "total_atendimentos": 0,
  "vendas_realizadas": 0,
  ...
}
```

---

### 2. Cadastrar cliente — `POST /api/farmacias`

**Com `fase: 'entrada'`** — url_base, email e senha NÃO são obrigatórios:

```json
// Request
{
  "nome": "Farmácia Nova",
  "fase": "entrada",
  "telefone": "(11) 99999-1234",
  "responsavel": "João Silva",
  "cidade": "São Paulo",
  "tem_chatbot": true,
  "gestor_id": null
}

// Response 201
{
  "id": 55,
  "nome": "Farmácia Nova",
  "fase": "entrada",
  "gestor_id": null,
  "tem_chatbot": true
}
```

**Com `fase: 'ativo'`** (ou omitido) — url_base, email e senha SÃO obrigatórios quando `tem_chatbot: true`:

```json
{
  "nome": "Farmácia Beta",
  "url_base": "https://app.pharmachatbot.com/cliente/xxx",
  "email": "farmacia@email.com",
  "senha": "senhaSegura123",
  "gestor_id": 3,
  "tem_chatbot": true
}
```

---

### 3. Editar cliente — `PUT /api/farmacias/:id`

Aceita todos os campos existentes + os novos. Útil para atribuir gestor a um cliente de entrada:

```json
// Atribuir gestor
{
  "gestor_id": 5
}

// Editar dados de contato
{
  "telefone": "(11) 88888-4321",
  "responsavel": "Maria Santos",
  "cidade": "Campinas"
}

// Editar fase manualmente (se necessário)
{
  "fase": "entrada"
}
```

---

### 4. Ativar cliente — `PATCH /api/farmacias/:id/ativar`  ⭐ NOVO

Promove um cliente de `'entrada'` para `'ativo'` cadastrando as credenciais da plataforma.

- Só funciona em clientes com `fase: 'entrada'`. Retorna 400 se já estiver ativo.
- Se `tem_chatbot: true`, os campos `url_base`, `email` e `senha` são **obrigatórios**.
- Se `tem_chatbot: false`, nenhum desses campos é obrigatório (cliente só para reuniões).

```json
// Request
PATCH /api/farmacias/55/ativar

{
  "url_base": "https://app.pharmachatbot.com/cliente/farmacianova",
  "email": "farmacianoval@email.com",
  "senha": "senhaDaPlataforma",
  "gestor_id": 5
}

// Response 200
{
  "id": 55,
  "nome": "Farmácia Nova",
  "fase": "ativo",
  "gestor_id": 5,
  "mensagem": "Farmácia ativada com sucesso."
}
```

**Erros possíveis:**

| Status | Motivo |
|--------|--------|
| 400    | `"Farmácia já está ativa."` — já foi ativada antes |
| 400    | `"Para ativar uma farmácia com chatbot, url_base, email e senha são obrigatórios."` |
| 404    | Farmácia não encontrada |

---

## UI — O que precisa ser criado/atualizado

### A. Formulário de cadastro de farmácia

Adicionar toggle/selector de fase no topo do modal:

```
( ) Cliente de Entrada    (●) Cliente Ativo
```

**Quando "Cliente de Entrada":**
- Mostrar: Nome*, Telefone, Responsável, Cidade, Tem Chatbot, Gestor (opcional)
- Ocultar: URL da Plataforma, Email da Plataforma, Senha da Plataforma
- Observações (textarea, opcional)

**Quando "Cliente Ativo" (comportamento atual):**
- Mostrar todos os campos, URL/Email/Senha obrigatórios se Tem Chatbot = true

---

### B. Listagem de farmácias — badge de fase

Na tabela/cards de farmácias, exibir um badge visual para clientes de entrada:

```
[ENTRADA]  Farmácia Nova          João Silva · (11) 99999-1234 · São Paulo
           Sem gestor atribuído   Aguardando ativação
```

Sugestão de cores:
- `fase: 'entrada'` → badge amarelo/laranja: `"Em Onboarding"` ou `"Entrada"`
- `fase: 'ativo'` → sem badge (comportamento atual)

Clientes de entrada **não têm dados de ranking** (receita, atendimentos = 0). Isso é esperado — não exibir barras de progresso ou alertas para eles.

---

### C. Aba ou seção separada para clientes de entrada

Opção 1 — filtro na listagem existente:
- Adicionar tab "Todos | Ativos | Em Entrada" na tela de farmácias
- Tab "Em Entrada" chama `GET /api/farmacias?fase=entrada`

Opção 2 — seção dedicada no sidebar:
- "Clientes de Entrada" como item separado no menu admin

Recomendação: **Opção 1 (tabs)** para manter tudo em uma tela.

---

### D. Modal/drawer de ativação

Ao clicar num cliente de entrada, além das opções normais de editar/desativar, mostrar botão:

**[Ativar Cliente]**

Ao clicar, abre um formulário com:
- URL da Plataforma* (campo url_base)
- Email da Plataforma* (campo email)
- Senha da Plataforma* (campo senha, com toggle mostrar/ocultar)
- Gestor* (select com lista de gestores, pré-preenchido se já tiver)

Ao confirmar, chama `PATCH /api/farmacias/:id/ativar`.

---

### E. Card de cliente de entrada (visão compacta)

```
┌─────────────────────────────────────────────────────┐
│  [ENTRADA]  Farmácia Nova                            │
│  👤 João Silva   📞 (11) 99999-1234   📍 São Paulo  │
│  Gestor: Maria Gestora                               │
│  Tem chatbot: Sim                                    │
│                                    [Ativar Cliente]  │
└─────────────────────────────────────────────────────┘
```

---

## Regras de negócio importantes

1. Clientes de entrada **não aparecem no painel de ranking** nem no dashboard de métricas (receita, atendimentos = 0 — filtrar visualmente).
2. Clientes de entrada **podem ter reuniões agendadas** (o campo `farmacia_id` aceita qualquer farmácia ativa).
3. Só admins veem e gerenciam clientes de entrada.
4. Gestores **não conseguem ver** clientes de entrada que não estejam atribuídos a eles (comportamento padrão da autenticação).
5. Após ativação, o cliente entra no próximo ciclo do pipeline de scraping automaticamente.

---

## Checklist de implementação

- [ ] Atualizar tipo `Farmacia` no frontend para incluir `fase`, `telefone`, `responsavel`, `cidade`
- [ ] Formulário de cadastro com toggle Entrada/Ativo
- [ ] Listagem com tabs Todos / Ativos / Em Entrada
- [ ] Badge visual para `fase: 'entrada'` na lista
- [ ] Modal de ativação (`PATCH /api/farmacias/:id/ativar`)
- [ ] Suprimir gráficos/métricas para clientes de entrada na listagem
- [ ] Validação no frontend: se Entrada → não exigir URL/email/senha
