# Regras de Negócio — Pharma Chat Bot (SaaS)

## 1. Perfis de Usuário

O sistema possui 3 perfis fixos, criados via seed no banco:

| ID | Nome | Tag | Descrição |
|---|---|---|---|
| 1 | Usuário | `user` | Atendente comum |
| 2 | Administrador | `admin` | Gerencia a empresa |
| 3 | Súper Administrador | `superAdmin` | Acesso total ao sistema, sem vínculo com empresa |

Além dos perfis, existe o campo `finance = true` em qualquer usuário — isso marca o usuário como **responsável financeiro**, dando acesso exclusivo para configurar módulos pagos.

---

## 2. Ciclo de Vida do Usuário

### Criação
Um usuário é criado com:
- Nome, e-mail e senha (bcrypt, 10 rounds)
- `profile_id` (define o papel)
- `email_verified` (padrão `true` — mas pode ser desativado por fluxo externo de verificação)
- `company_id` (pode ser nulo no momento da criação)

### Vinculação à Empresa
- Um usuário **pode existir sem empresa** no banco
- Porém, **não consegue logar** sem empresa — exceto superAdmin
- A vinculação é feita separadamente, após a criação

### Aprovação do Financeiro
- Quando um usuário tenta logar sem `company_id`, o sistema retorna:
  > *"Sua conta está indisponível no momento. Entre em contato com o financeiro."*
- Isso indica que o financeiro ainda não aprovou/criou a empresa e vinculou o usuário

---

## 3. Fluxo de Login (todas as regras em ordem)

```
1. Email + senha válidos?           → NÃO → "Usuário ou senha inválido"
2. email_verified = true?           → NÃO → "Email não verificado"
3. Tem company_id? (não-superAdmin) → NÃO → "Conta indisponível, contate o financeiro"
4. company.status = true?           → NÃO → "Empresa inativa"
                                    → SIM → Login liberado ✓
```

**Exceções:**
- `superAdmin` pula as verificações 3 e 4
- Após login, o token JWT gerado contém: `{ email, userId, company_id }`
- Sessão é cacheada no **Redis** com a chave `company-{company_id}-user-{user_id}`

---

## 4. Estrutura de Empresa (Tenant)

Cada empresa é um **tenant isolado** no sistema. Campos principais:

| Campo | Descrição |
|---|---|
| `name` | Nome da empresa |
| `status` | `true` = ativa, `false` = inativa (bloqueia login de todos os usuários) |
| `plan_id` | Plano contratado |
| `plan_type` | `boleto` ou `credito` |
| `token` | Token de API da empresa |
| `stripe_customer_id` | ID no Stripe para cobranças |
| `cnpj_cpf` | Identificação fiscal |
| `whatsapp_lib` | Biblioteca WhatsApp usada |

---

## 5. Permissões por Empresa (`company_permissions`)

Cada empresa tem uma linha na tabela `company_permissions` com **dezenas de flags booleanos** que ativam/desativam funcionalidades no menu e no sistema. Todas por padrão são `false`.

### Funcionalidades de Atendimento
| Flag | O que ativa |
|---|---|
| `show_all_tickets` | Atendente vê todos os tickets |
| `group_ticket` | Tickets de grupo |
| `show_group_contact` | Ver contato em tickets de grupo |
| `restrict_user` | Restringe ações do atendente |
| `allow_close_pending_tickets` | Botão "X" na aba Aguardando |
| `limit_services_users` | Limita quantidade de atendentes simultâneos |
| `number_limit_services_users` | Número máximo de atendentes (quando limitado) |

### Funcionalidades de Módulos
| Flag | O que ativa |
|---|---|
| `active_crm` | Módulo CRM / Dashboard |
| `active_kanban` | Módulo Kanban |
| `internal_chat` | Chat interno entre atendentes |
| `google_calendar` | Integração Google Agenda |
| `api_messages` | Envio de mensagens via API |

### Integrações de Terceiros
Cada integração tem sua própria flag + token + configurações:
- `mik_web`, `beesweb`, `ixcsoftware`, `sgp`, `brbyte`, `projuris`, `atlaz`, `asaas`, `super_logica`, `condomob`, `trier_systems`, `clickup`

### Fechamento Automático de Tickets
| Flag | Descrição |
|---|---|
| `close_open_tickets` | Fecha tickets abertos por inatividade |
| `close_open_tickets_interval` | Intervalo em minutos |
| `close_pending_tickets` | Fecha tickets pendentes por inatividade |
| `close_pending_tickets_interval` | Intervalo em minutos |

---

## 6. Módulos Pagos (`company_modules`)

Além das permissões, existem módulos com ciclo de vida próprio:

| Campo | Descrição |
|---|---|
| `module_type` | `encarte`, `campanha`, `chatgpt`, `chatbot` |
| `status` | `active`, `inactive`, `expired`, `cancelled` |
| `start_date` / `end_date` | Período de vigência |
| `auto_renew` | Renovação automática |
| `payment_type` | `monthly` ou `yearly` |
| `amount` | Valor cobrado |

**Regra:** Quando `end_date` passa sem renovação, o status vai para `expired` e o módulo é desativado.

**Trial:** O módulo `encarte` suporta período de teste (`company_trials`), com status `started` → `ended`.

---

## 7. Assinatura e Cobrança (`company_subscription`)

Cada empresa pode ter uma assinatura com:
- **Mercado Pago** (via `mercado_pago_subscription_id`)
- **Stripe** (via `stripe_customer_id`, `stripe_price_id`, `stripe_session_id`)
- Status: `active`, `inactive`, `pending`, `cancelled`
- Controle de período: `current_period_start`, `current_period_end`, `cancel_at_period_end`

**Acesso exclusivo do Financeiro:** Apenas usuários com `finance = true` ou `superAdmin` podem alterar configurações de módulos. Qualquer outro recebe:
> *"Acesso negado! Apenas usuários financeiros podem alterar configurações de módulos."*

---

## 8. Feature Flags Dinâmicos (`company_feature_flags`)

Sistema adicional de flags por empresa, mais flexível que `company_permissions`:
- Chave: `(company_id, feature_flag_id)`
- `is_enabled`: liga/desliga a feature para aquela empresa
- Permite ativar funcionalidades experimentais por tenant sem alterar a estrutura da tabela

---

## 9. Resumo Visual do Fluxo Completo

```
FINANCEIRO cria Empresa
    └── Define plano, status=true, permissões
    └── Cria usuário vinculado à empresa
    └── Ativa módulos necessários (encarte, crm, etc.)

USUÁRIO tenta logar
    ├── email_verified? → se não, bloqueado
    ├── tem empresa? → se não, "contate o financeiro"
    ├── empresa ativa? → se não, "empresa inativa"
    └── ✓ Login liberado
            └── JWT gerado com company_id
            └── Menu exibe apenas features com flag=true na empresa
            └── Sessão cacheada no Redis
```
