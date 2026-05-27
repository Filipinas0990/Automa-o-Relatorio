# SPEC TÉCNICO — Feature Reuniões com Gestores
**PharmaFlow v2 — Frontend**
**Tech Lead:** Claude (Sonnet 4.6)
**Data:** 2026-05-27
**Status:** Pronto para implementação

---

## 1. Contexto e Objetivo

Gestores precisam marcar, confirmar e registrar reuniões com as farmácias que gerenciam.
A feature deve responder:

> *"Quantas reuniões tive este mês?"*
> *"Essa reunião foi confirmada?"*
> *"Consigo ver o histórico de todas as reuniões com a Farmácia São Rafael?"*
> *"Quero adicionar essa reunião direto no meu Google Agenda"*

---

## 2. Arquitetura Visual — Três Telas

```
┌─────────────────────────────────────────────────────────────────┐
│  TELA 1 — Lista de Reuniões (página principal /reunioes)         │
│  Stats no topo + filtros + cards por farmácia                    │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  TELA 2 — Modal Agendar / Editar Reunião                         │
│  Formulário completo com data, hora, local, link Meet            │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  TELA 3 — Detalhe da Reunião (drawer lateral ou modal grande)    │
│  Todos os dados + ações (Confirmar / Realizar / Cancelar)        │
│  + botão Google Calendar                                         │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. API Contract — Todas as Rotas

### Base URL
```
https://api.pharmarelatorios.online
```

### Headers obrigatórios em todas as rotas (exceto callback)
```ts
{ Authorization: `Bearer ${token}` }
```

---

### 3.1 Stats — Cards do topo da página

```
GET /api/reunioes/stats
```

**Resposta:**
```json
{
  "reunioes_mes": 5,
  "total_realizadas": 23,
  "agendadas_futuras": 3,
  "confirmadas_futuras": 1
}
```

**Quando chamar:** ao entrar na página, ao criar/alterar qualquer reunião.

---

### 3.2 Listar Reuniões

```
GET /api/reunioes
GET /api/reunioes?farmacia_id=3
GET /api/reunioes?status=agendada
GET /api/reunioes?mes=2026-05
GET /api/reunioes?farmacia_id=3&status=confirmada
```

**Resposta (array):**
```json
[
  {
    "id": 1,
    "farmacia_id": 1,
    "farmacia_nome": "São Rafael",
    "gestor_nome": "Carlos Silva",
    "titulo": "Revisão de metas maio",
    "descricao": "Analisar performance dos canais",
    "data_reuniao": "2026-06-05T14:00:00Z",
    "duracao_minutos": 60,
    "local": "Online",
    "link_meet": "https://meet.google.com/abc-def-ghi",
    "status": "confirmada",
    "google_event_id": "abc123",
    "observacoes": null,
    "criado_em": "2026-05-27T10:00:00Z",
    "google_link": "https://calendar.google.com/calendar/render?..."
  }
]
```

**Quando chamar:**
- Ao entrar na página (sem filtros)
- Ao trocar de aba (Todas / Agendadas / Confirmadas / Realizadas)
- Ao buscar por farmácia
- Ao filtrar por mês

---

### 3.3 Criar Reunião

```
POST /api/reunioes
Content-Type: application/json
```

**Body:**
```json
{
  "farmacia_id": 1,
  "titulo": "Revisão de metas maio",
  "descricao": "Texto opcional",
  "data_reuniao": "2026-06-05T14:00:00.000Z",
  "duracao_minutos": 60,
  "local": "Online",
  "link_meet": "https://meet.google.com/abc-def-ghi",
  "gestor_id": 2
}
```

**Campos obrigatórios:** `farmacia_id`, `titulo`, `data_reuniao`
**Campos opcionais:** todos os outros

**Resposta (201):**
```json
{
  "id": 42,
  "status": "agendada",
  "google_link": "https://calendar.google.com/...",
  "google_event_sincronizado": true
}
```

**Depois de criar:** mostrar toast + botão "Abrir Google Agenda" com `google_link`.

---

### 3.4 Atualizar Reunião

```
PUT /api/reunioes/:id
Content-Type: application/json
```

**Body:** mesmos campos do POST (apenas os que mudaram).

---

### 3.5 Confirmar Reunião

```
PATCH /api/reunioes/:id/confirmar
```
Sem body. Muda status de `agendada` → `confirmada`.

---

### 3.6 Marcar como Realizada

```
PATCH /api/reunioes/:id/realizar
Content-Type: application/json
```

**Body (opcional):**
```json
{ "observacoes": "Reunião produtiva. Acordamos novo plano de mídia." }
```

---

### 3.7 Cancelar Reunião

```
PATCH /api/reunioes/:id/cancelar
```
Sem body. Remove automaticamente do Google Calendar se sincronizado.

---

### 3.8 Link Google Calendar (sem OAuth)

```
GET /api/reunioes/:id/google-link
```

**Resposta:**
```json
{
  "link": "https://calendar.google.com/calendar/render?action=TEMPLATE&text=..."
}
```

Abrir em nova aba: `window.open(link, '_blank')`.

---

### 3.9 Sincronizar com Google Calendar (com OAuth)

```
POST /api/reunioes/:id/sync-google
```

**Resposta (200):**
```json
{ "google_event_id": "abc123", "mensagem": "Evento sincronizado com sucesso." }
```

**Resposta (424) — Google não conectado:**
```json
{ "detail": "Google Calendar não conectado. Acesse /api/auth/google para autorizar." }
```

---

### 3.10 Status da conexão Google

```
GET /api/auth/google/status
```

**Resposta:**
```json
{
  "conectado": false,
  "google_configurado": true
}
```

Usar para mostrar/esconder botão "Conectar Google Agenda".

---

### 3.11 Conectar Google Calendar

```
GET /api/auth/google   ← com header Authorization
```

Redireciona para o Google. Após autorizar, Google redireciona para:
```
https://front-end-ecru-two-48.vercel.app/reunioes?google=connected
```

O frontend deve ler o `?google=connected` na URL e mostrar um toast de sucesso.

---

### 3.12 Desconectar Google Calendar

```
DELETE /api/auth/google
```

---

## 4. Wireframes Visuais

### 4.1 Página Principal — `/reunioes`

```
╔══════════════════════════════════════════════════════════════════════╗
║  Reuniões com Clientes                          [▶ Rodar Agora]     ║
╠══════════════════════════════════════════════════════════════════════╣
║                                                                      ║
║  ┌────────────────┐  ┌─────────────────────┐  ┌──────────────────┐  ║
║  │  📅  5         │  │  ✅  23             │  │  🕐  3           │  ║
║  │  Reuniões      │  │  Total realizadas   │  │  Agendadas       │  ║
║  │  este mês      │  │  (histórico)        │  │  (futuras)       │  ║
║  └────────────────┘  └─────────────────────┘  └──────────────────┘  ║
║                                                                      ║
║  ┌──────────────────────────────────────────────────────────────┐    ║
║  │  🔍  Buscar farmácia...                                      │    ║
║  └──────────────────────────────────────────────────────────────┘    ║
║                                                                      ║
║  [Todas]  [Agendadas]  [Confirmadas]  [Realizadas]  [Canceladas]    ║
║   ← abas de filtro de status                                         ║
║                                                                      ║
║  ┌──────────────────────────────┐  ┌──────────────────────────────┐  ║
║  │  🏥 São Rafael               │  │  🏥 Hiper-popular            │  ║
║  │                              │  │                              │  ║
║  │  📅 1 reunião este mês       │  │  📅 0 reuniões este mês      │  ║
║  │  ✅ 2 no total               │  │  ✅ 0 no total               │  ║
║  │                              │  │                              │  ║
║  │  ┌──────────────────────┐    │  │  Nenhuma reunião             │  ║
║  │  │ 05/Jun 14h           │    │  │  agendada ainda.             │  ║
║  │  │ Revisão de metas     │    │  │                              │  ║
║  │  │ 🟡 Confirmada        │    │  │                              │  ║
║  │  └──────────────────────┘    │  │                              │  ║
║  │                   [+ Agendar]│  │               [+ Agendar]   │  ║
║  └──────────────────────────────┘  └──────────────────────────────┘  ║
║                                                                      ║
║  ─── Banner Google Calendar (se não conectado) ────────────────────  ║
║  ┌──────────────────────────────────────────────────────────────┐    ║
║  │  📆  Conecte seu Google Agenda para sincronizar reuniões     │    ║
║  │      automaticamente.              [Conectar Google Agenda]  │    ║
║  └──────────────────────────────────────────────────────────────┘    ║
╚══════════════════════════════════════════════════════════════════════╝
```

---

### 4.2 Modal — Agendar Nova Reunião

```
╔══════════════════════════════════════════════════════╗
║  📅  Agendar Reunião                             [✕] ║
╠══════════════════════════════════════════════════════╣
║                                                      ║
║  Farmácia *                                          ║
║  ┌────────────────────────────────────────────┐      ║
║  │  São Rafael                           [▼]  │      ║
║  └────────────────────────────────────────────┘      ║
║                                                      ║
║  Título da reunião *                                 ║
║  ┌────────────────────────────────────────────┐      ║
║  │  Revisão de metas de maio                  │      ║
║  └────────────────────────────────────────────┘      ║
║                                                      ║
║  ┌──────────────────────┐  ┌─────────────────────┐   ║
║  │  Data *              │  │  Hora *             │   ║
║  │  05/06/2026          │  │  14:00              │   ║
║  └──────────────────────┘  └─────────────────────┘   ║
║                                                      ║
║  ┌──────────────────────┐  ┌─────────────────────┐   ║
║  │  Duração             │  │  Local              │   ║
║  │  60 min         [▼]  │  │  Online             │   ║
║  └──────────────────────┘  └─────────────────────┘   ║
║                                                      ║
║  Link da reunião (Google Meet, Zoom...)               ║
║  ┌────────────────────────────────────────────┐      ║
║  │  https://meet.google.com/abc-def-ghi       │      ║
║  └────────────────────────────────────────────┘      ║
║                                                      ║
║  Descrição                                           ║
║  ┌────────────────────────────────────────────┐      ║
║  │  Analisar performance dos canais...        │      ║
║  │                                            │      ║
║  └────────────────────────────────────────────┘      ║
║                                                      ║
║         [Cancelar]          [✅ Agendar Reunião]     ║
╚══════════════════════════════════════════════════════╝
```

**Após salvar — Toast de sucesso:**
```
╔══════════════════════════════════════════════╗
║  ✅ Reunião agendada!                         ║
║  [📅 Adicionar ao Google Agenda]             ║
╚══════════════════════════════════════════════╝
```

---

### 4.3 Drawer Lateral — Detalhe da Reunião

```
                          ╔══════════════════════════════════╗
                          ║  Revisão de metas              ✕ ║
                          ╠══════════════════════════════════╣
                          ║                                  ║
                          ║  🏥 São Rafael                   ║
                          ║  👤 Carlos Silva                 ║
                          ║                                  ║
                          ║  ┌──────────────────────────┐    ║
                          ║  │  🟡  CONFIRMADA          │    ║
                          ║  └──────────────────────────┘    ║
                          ║                                  ║
                          ║  📅  Quinta, 05 Jun 2026         ║
                          ║  🕐  14:00 — 15:00 (60 min)     ║
                          ║  📍  Online                      ║
                          ║  🔗  meet.google.com/abc-def-ghi ║
                          ║                                  ║
                          ║  Descrição:                      ║
                          ║  Analisar performance dos        ║
                          ║  canais de mídia...              ║
                          ║                                  ║
                          ║  ──── Ações ────────────────     ║
                          ║                                  ║
                          ║  [📅 Abrir no Google Agenda]     ║
                          ║  [🔄 Sincronizar Google]         ║
                          ║                                  ║
                          ║  [✅ Marcar como Realizada]      ║
                          ║  [✏️  Editar]                    ║
                          ║  [❌ Cancelar Reunião]           ║
                          ║                                  ║
                          ╚══════════════════════════════════╝
```

**Se status = realizada — campo de observações:**
```
                          ║  ──── Observações ──────────     ║
                          ║  ┌──────────────────────────┐    ║
                          ║  │  Reunião produtiva.       │    ║
                          ║  │  Acordamos novo plano...  │    ║
                          ║  └──────────────────────────┘    ║
```

---

### 4.4 Modal — Marcar como Realizada

```
╔══════════════════════════════════════════╗
║  ✅  Marcar Reunião como Realizada    [✕]║
╠══════════════════════════════════════════╣
║                                          ║
║  Revisão de metas — São Rafael           ║
║  05/06/2026 às 14:00                     ║
║                                          ║
║  Observações (opcional):                 ║
║  ┌──────────────────────────────────┐    ║
║  │  Como foi a reunião? O que foi   │    ║
║  │  acordado?                       │    ║
║  │                                  │    ║
║  └──────────────────────────────────┘    ║
║                                          ║
║      [Cancelar]    [✅ Confirmar]        ║
╚══════════════════════════════════════════╝
```

---

## 5. Cards de Reunião — Componente `<ReuniaoCard />`

Aparece dentro do card de cada farmácia na lista principal.

```
┌──────────────────────────────────────────┐
│  📅  Qui 05 Jun, 14:00                   │
│  Revisão de metas de maio                │
│  ⏱ 60 min  •  📍 Online                  │
│                          🟡 Confirmada   │
└──────────────────────────────────────────┘
```

**Clicando no card:** abre o Drawer de detalhe.

---

## 6. Badges de Status

| Status | Cor | Ícone | Texto |
|--------|-----|-------|-------|
| `agendada` | Amarelo `#F59E0B` | 📅 | Agendada |
| `confirmada` | Verde `#10B981` | ✅ | Confirmada |
| `realizada` | Azul `#3B82F6` | 🏆 | Realizada |
| `cancelada` | Vermelho `#EF4444` | ❌ | Cancelada |

```tsx
const STATUS_CONFIG = {
  agendada:   { cor: '#F59E0B', bg: 'rgba(245,158,11,0.1)',  label: 'Agendada'   },
  confirmada: { cor: '#10B981', bg: 'rgba(16,185,129,0.1)', label: 'Confirmada' },
  realizada:  { cor: '#3B82F6', bg: 'rgba(59,130,246,0.1)', label: 'Realizada'  },
  cancelada:  { cor: '#EF4444', bg: 'rgba(239,68,68,0.1)',  label: 'Cancelada'  },
};
```

---

## 7. Fluxos Completos

### 7.1 Fluxo Agendar Reunião

```
Usuário clica [+ Agendar] no card da farmácia
  ↓
Abre Modal de Agendamento (farmácia pré-selecionada)
  ↓
Preenche: título, data, hora, duração, local, link, descrição
  ↓
Clica [Agendar Reunião]
  ↓
POST /api/reunioes
  ↓
200 OK → fecha modal
  ↓
Toast: "✅ Reunião agendada!"
  ↓ (se google_event_sincronizado = false)
Botão no toast: [📅 Adicionar ao Google Agenda]
  → window.open(google_link, '_blank')
  ↓
Refaz GET /api/reunioes  →  atualiza lista
Refaz GET /api/reunioes/stats  →  atualiza contadores
```

---

### 7.2 Fluxo Confirmar Reunião

```
Usuário clica no card da reunião (status: agendada)
  ↓
Drawer de detalhe abre
  ↓
Clica [✅ Confirmar Reunião]
  ↓
PATCH /api/reunioes/:id/confirmar
  ↓
Badge muda para "🟢 Confirmada"
  ↓
Toast: "Reunião confirmada!"
```

---

### 7.3 Fluxo Marcar como Realizada

```
Usuário abre detalhe (status: confirmada ou agendada)
  ↓
Clica [✅ Marcar como Realizada]
  ↓
Abre Modal de Observações
  ↓
Escreve observações (opcional) → clica [Confirmar]
  ↓
PATCH /api/reunioes/:id/realizar  { observacoes: "..." }
  ↓
Badge muda para "🔵 Realizada"
  ↓
Drawer mostra campo de observações salvas
```

---

### 7.4 Fluxo Cancelar Reunião

```
Usuário clica [❌ Cancelar Reunião] no drawer
  ↓
Confirmação: "Tem certeza? Isso removerá o evento do Google Agenda."
  ↓
[Confirmar cancelamento]
  ↓
PATCH /api/reunioes/:id/cancelar
  ↓
Badge muda para "🔴 Cancelada"
  ↓
Toast: "Reunião cancelada."
  ↓
Fecha drawer
```

---

### 7.5 Fluxo Conectar Google Calendar

```
Usuário vê banner "Conecte seu Google Agenda"
  ↓
Clica [Conectar Google Agenda]
  ↓
Chama GET /api/auth/google (com token)
  ↓
API retorna redirect → window.location.href = url_do_google
  ↓
Usuário autoriza no Google
  ↓
Google redireciona para: /reunioes?google=connected
  ↓
Frontend lê ?google=connected na URL
  ↓
Toast: "✅ Google Agenda conectado!"
  ↓
Remove banner  /  mostra ícone de Google conectado no header
  ↓
Refaz GET /api/auth/google/status  →  { conectado: true }
```

---

## 8. Gestão de Estado

```tsx
// Estado da página /reunioes
interface ReunioeState {
  // Dados
  reunioes:         Reuniao[];
  stats:            ReuniaoStats;
  googleConectado:  boolean;

  // UI
  filtroStatus:     'todas' | 'agendada' | 'confirmada' | 'realizada' | 'cancelada';
  filtroBusca:      string;
  filtroMes:        string | null;           // 'YYYY-MM' ou null

  // Modais
  modalAgendar:     { aberto: boolean; farmaciaId?: number };
  drawerDetalhe:    { aberto: boolean; reuniaoId?: number };
  modalRealizar:    { aberto: boolean; reuniaoId?: number };
}
```

---

## 9. Tratamento de Erros

| Situação | O que mostrar |
|----------|---------------|
| Rede offline | Toast vermelho: "Sem conexão com o servidor" |
| 401 Unauthorized | Redirecionar para /login |
| 403 Forbidden | Toast: "Você não tem acesso a esta reunião" |
| 404 | Toast: "Reunião não encontrada" |
| 424 (Google não conectado) | Toast amarelo: "Conecte o Google Agenda para sincronizar" + botão |
| 503 (Google não configurado) | Esconder todos os botões de Google |
| Criação com campos faltando | Validar no front ANTES de chamar a API |

---

## 10. Componentes a Criar

| # | Componente | Onde aparece | Complexidade |
|---|-----------|--------------|--------------|
| 1 | `<ReunioeStats />` | Topo da página | Baixa |
| 2 | `<FiltroAbas />` | Abaixo dos stats | Baixa |
| 3 | `<FarmaciaReuniaoCard />` | Grid principal | Média |
| 4 | `<ReuniaoCard />` | Dentro do card da farmácia | Baixa |
| 5 | `<StatusBadge />` | Em vários lugares | Baixa |
| 6 | `<ModalAgendarReuniao />` | Ao clicar "+ Agendar" | Alta |
| 7 | `<DrawerDetalhesReuniao />` | Ao clicar na reunião | Alta |
| 8 | `<ModalMarcarRealizada />` | Dentro do drawer | Média |
| 9 | `<BannerGoogleCalendar />` | Rodapé da página | Baixa |
| 10 | `<GoogleStatusBadge />` | Header ou settings | Baixa |

---

## 11. Leitura do Query Param após OAuth

```tsx
// Em /reunioes — ao montar a página:
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  const google  = params.get('google');

  if (google === 'connected') {
    toast.success('✅ Google Agenda conectado com sucesso!');
    setGoogleConectado(true);
    // Remove o param da URL sem recarregar
    window.history.replaceState({}, '', '/reunioes');
  }
  if (google === 'error') {
    toast.error('Erro ao conectar o Google Agenda. Tente novamente.');
    window.history.replaceState({}, '', '/reunioes');
  }
  if (google === 'already_connected') {
    toast.info('Google Agenda já estava conectado.');
    window.history.replaceState({}, '', '/reunioes');
  }
}, []);
```

---

## 12. Chamadas Paralelas ao Carregar a Página

```ts
// Ao entrar em /reunioes — carregar tudo de uma vez
const [reunioes, stats, googleStatus] = await Promise.all([
  fetch('/api/reunioes',              { headers }),
  fetch('/api/reunioes/stats',        { headers }),
  fetch('/api/auth/google/status',    { headers }),
]);
```

---

## 13. Fluxo "Adicionar ao Google Agenda" (sem OAuth)

Disponível SEMPRE, independente de conectar o Google.
Cada reunião retorna um campo `google_link` pronto para uso:

```tsx
// Botão simples — abre Google Calendar no navegador com evento pré-preenchido
<button onClick={() => window.open(reuniao.google_link, '_blank')}>
  📅 Abrir no Google Agenda
</button>
```

---

## 14. Responsividade

| Tela | Layout |
|------|--------|
| Desktop (> 1024px) | Grid 2 colunas de cards |
| Tablet (768–1024px) | Grid 1 coluna, drawer em 50% da tela |
| Mobile (< 768px) | 1 coluna, drawer ocupa tela inteira |

---

## 15. Ordem de Implementação Sugerida

| # | Tarefa | Tempo estimado |
|---|--------|----------------|
| 1 | `<ReunioeStats />` + chamada GET /stats | 30 min |
| 2 | `<FarmaciaReuniaoCard />` + listagem GET /reunioes | 1h |
| 3 | `<StatusBadge />` + `<ReuniaoCard />` | 30 min |
| 4 | `<ModalAgendarReuniao />` + POST | 2h |
| 5 | `<DrawerDetalhesReuniao />` | 2h |
| 6 | Ações: confirmar / realizar / cancelar | 1h |
| 7 | `<ModalMarcarRealizada />` | 45 min |
| 8 | `<BannerGoogleCalendar />` + fluxo OAuth | 1h |
| 9 | Leitura de `?google=` na URL + toasts | 30 min |
| 10 | Filtros (abas + busca + mês) | 1h |

**Total estimado: ~10h de desenvolvimento**

---

## 16. Critérios de Aceite

- [ ] Stats do topo refletem os dados reais da API
- [ ] Cards de farmácia mostram as próximas reuniões agendadas
- [ ] Clicar em "+ Agendar" abre modal com farmácia pré-selecionada
- [ ] Criar reunião atualiza a lista e os stats sem recarregar a página
- [ ] Botão "Adicionar ao Google Agenda" abre o link correto em nova aba
- [ ] Confirmar reunião muda o badge de Amarelo para Verde
- [ ] Marcar como Realizada salva as observações corretamente
- [ ] Cancelar exibe confirmação antes de executar
- [ ] Banner Google aparece apenas quando não conectado
- [ ] Após OAuth, `?google=connected` exibe toast de sucesso
- [ ] Filtros por status e busca por nome funcionam sem recarregar
- [ ] Layout responsivo: funciona em mobile (drawer em tela cheia)

---

*Documento gerado pelo Tech Lead. Backend já implementado e disponível em `api.pharmarelatorios.online`.*
*Para dúvidas sobre endpoints, consultar o arquivo `pharmaflow-node/src/api/index.ts`.*
