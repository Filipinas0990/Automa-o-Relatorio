# SPEC — Cadastro de Farmácia Sem ChatBot

**Versão:** 1.0  
**Data:** 2026-05-27  
**Backend já implementado:** ✅  
**Migrations necessárias:** `0005_add_tem_chatbot.sql`

---

## Contexto

Algumas farmácias clientes não possuem chatbot configurado — precisam apenas ser cadastradas para que o gestor possa registrar **reuniões** e acompanhar o histórico. Nesses casos, não é necessário informar URL, e-mail ou senha.

O campo `tem_chatbot` controla esse comportamento:

| `tem_chatbot` | Campos exigidos | Scraping |
|---|---|---|
| `true` (padrão) | nome + url_base + email + senha + gestor | ✅ Executa scraping |
| `false` | nome + gestor_id (opcional) | ❌ Não entra no pipeline |

---

## Rotas Utilizadas

### `GET /api/farmacias`
Retorna a lista de farmácias. **Novo campo no response:**
```json
{
  "id": 7,
  "nome": "Farmácia Central",
  "tem_chatbot": false,
  "gestor_id": 3,
  "status": "Ativa",
  ...
}
```

### `POST /api/farmacias`
Cria uma nova farmácia.

**Payload mínimo (sem chatbot):**
```json
{
  "nome": "Drogaria São João",
  "gestor_id": 2,
  "tem_chatbot": false
}
```

**Payload completo (com chatbot):**
```json
{
  "nome": "Farmácia Bem Estar",
  "url_base": "https://app.farmabem.com.br",
  "email": "admin@farmabem.com.br",
  "senha": "senhaSegura",
  "gestor_id": 2,
  "tem_chatbot": true
}
```

**Resposta (201):**
```json
{
  "id": 8,
  "nome": "Drogaria São João",
  "gestor_id": 2,
  "tem_chatbot": false
}
```

**Erro (400) — campos obrigatórios ausentes quando tem_chatbot=true:**
```json
{
  "detail": "Para farmácias com chatbot, os campos url_base, email e senha são obrigatórios."
}
```

### `PUT /api/farmacias/:id`
Atualiza dados da farmácia, incluindo `tem_chatbot`.

---

## Componente: Modal de Cadastro/Edição de Farmácia

### Localização
`src/components/FarmaciaModal.tsx` (ou onde estiver o modal atual de cadastro)

### Layout Wireframe

```
┌─────────────────────────────────────────────────────────┐
│  ➕ Nova Farmácia                               [✕]     │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  Nome da Farmácia *                                      │
│  ┌────────────────────────────────────────────────────┐ │
│  │ Farmácia Bem Estar                                 │ │
│  └────────────────────────────────────────────────────┘ │
│                                                          │
│  Gestor Responsável                                      │
│  ┌────────────────────────────────────────────────────┐ │
│  │ João Silva                               [▼]       │ │
│  └────────────────────────────────────────────────────┘ │
│                                                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │  🤖  Esta farmácia NÃO tem ChatBot              │    │
│  │      [ ] Marcar como sem chatbot                │    │
│  └─────────────────────────────────────────────────┘    │
│                                                          │
│  ─────────── Configuração do ChatBot ──────────────      │
│  (oculto quando "sem chatbot" estiver marcado)           │
│                                                          │
│  URL do Sistema *                                        │
│  ┌────────────────────────────────────────────────────┐ │
│  │ https://app.farmabem.com.br                        │ │
│  └────────────────────────────────────────────────────┘ │
│                                                          │
│  E-mail de Acesso *                                      │
│  ┌────────────────────────────────────────────────────┐ │
│  │ admin@farmabem.com.br                              │ │
│  └────────────────────────────────────────────────────┘ │
│                                                          │
│  Senha *                                                 │
│  ┌────────────────────────────────────────────────────┐ │
│  │ ••••••••••                                         │ │
│  └────────────────────────────────────────────────────┘ │
│                                                          │
├─────────────────────────────────────────────────────────┤
│              [Cancelar]      [💾 Salvar Farmácia]       │
└─────────────────────────────────────────────────────────┘
```

**Quando "sem chatbot" marcado:**
```
┌─────────────────────────────────────────────────────────┐
│  ➕ Nova Farmácia                               [✕]     │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  Nome da Farmácia *                                      │
│  ┌────────────────────────────────────────────────────┐ │
│  │ Drogaria São João                                  │ │
│  └────────────────────────────────────────────────────┘ │
│                                                          │
│  Gestor Responsável                                      │
│  ┌────────────────────────────────────────────────────┐ │
│  │ João Silva                               [▼]       │ │
│  └────────────────────────────────────────────────────┘ │
│                                                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │  🤖  Esta farmácia NÃO tem ChatBot        [✓]   │    │
│  │      ✅ Somente reuniões serão registradas      │    │
│  └─────────────────────────────────────────────────┘    │
│                                                          │
│  (campos URL, e-mail e senha ficam ocultos)              │
│                                                          │
├─────────────────────────────────────────────────────────┤
│              [Cancelar]      [💾 Salvar Farmácia]       │
└─────────────────────────────────────────────────────────┘
```

---

## Implementação React

### Estado do Formulário

```tsx
interface FarmaciaForm {
  nome: string;
  url_base: string;
  email: string;
  senha: string;
  gestor_id: number | null;
  tem_chatbot: boolean;
}

const [form, setForm] = useState<FarmaciaForm>({
  nome: '',
  url_base: '',
  email: '',
  senha: '',
  gestor_id: null,
  tem_chatbot: true,  // padrão: tem chatbot
});
```

### Toggle "Sem ChatBot"

```tsx
<div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
  <label className="flex items-center gap-3 cursor-pointer">
    <input
      type="checkbox"
      checked={!form.tem_chatbot}
      onChange={(e) => setForm(prev => ({
        ...prev,
        tem_chatbot: !e.target.checked,
        // Limpa campos desnecessários ao marcar "sem chatbot"
        url_base: e.target.checked ? '' : prev.url_base,
        email:    e.target.checked ? '' : prev.email,
        senha:    e.target.checked ? '' : prev.senha,
      }))}
      className="w-4 h-4 rounded border-orange-400 text-orange-600"
    />
    <div>
      <span className="font-medium text-orange-800">🤖 Esta farmácia NÃO tem ChatBot</span>
      {!form.tem_chatbot && (
        <p className="text-sm text-orange-600 mt-1">
          ✅ Somente reuniões serão registradas para esta farmácia
        </p>
      )}
    </div>
  </label>
</div>
```

### Campos Condicionais (mostrar/ocultar)

```tsx
{/* Campos de chatbot — apenas quando tem_chatbot = true */}
{form.tem_chatbot && (
  <div className="space-y-4 border-t pt-4 mt-2">
    <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
      Configuração do ChatBot
    </h3>

    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        URL do Sistema <span className="text-red-500">*</span>
      </label>
      <input
        type="url"
        placeholder="https://app.suafarmacia.com.br"
        value={form.url_base}
        onChange={e => setForm(p => ({ ...p, url_base: e.target.value }))}
        className="w-full border rounded-lg px-3 py-2 text-sm"
        required
      />
    </div>

    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        E-mail de Acesso <span className="text-red-500">*</span>
      </label>
      <input
        type="email"
        value={form.email}
        onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
        className="w-full border rounded-lg px-3 py-2 text-sm"
        required
      />
    </div>

    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        Senha <span className="text-red-500">*</span>
      </label>
      <input
        type="password"
        value={form.senha}
        onChange={e => setForm(p => ({ ...p, senha: e.target.value }))}
        className="w-full border rounded-lg px-3 py-2 text-sm"
        required
      />
    </div>
  </div>
)}
```

### Função de Submit

```tsx
const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();

  // Validação local
  if (!form.nome.trim()) {
    toast.error('Nome da farmácia é obrigatório');
    return;
  }
  if (form.tem_chatbot && (!form.url_base || !form.email || !form.senha)) {
    toast.error('URL, e-mail e senha são obrigatórios para farmácias com chatbot');
    return;
  }

  const payload: Record<string, unknown> = {
    nome: form.nome.trim(),
    tem_chatbot: form.tem_chatbot,
  };

  if (form.gestor_id) payload.gestor_id = form.gestor_id;

  if (form.tem_chatbot) {
    payload.url_base = form.url_base;
    payload.email    = form.email;
    payload.senha    = form.senha;
  }

  try {
    const url    = editandoId ? `/api/farmacias/${editandoId}` : '/api/farmacias';
    const method = editandoId ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Erro ao salvar farmácia');
    }

    toast.success(editandoId ? 'Farmácia atualizada!' : 'Farmácia cadastrada!');
    onClose();
    onRefresh();
  } catch (err: unknown) {
    toast.error(err instanceof Error ? err.message : 'Erro desconhecido');
  }
};
```

---

## Lista de Farmácias — Indicador Visual

Na listagem/tabela de farmácias, exibir um badge indicando se tem ou não chatbot:

```tsx
{/* Badge na coluna/card da farmácia */}
{farmacia.tem_chatbot ? (
  <span className="inline-flex items-center gap-1 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
    🤖 ChatBot
  </span>
) : (
  <span className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
    📋 Só Reuniões
  </span>
)}
```

---

## Comportamento no Dashboard Principal

Farmácias com `tem_chatbot = false`:
- **Aparecem** na lista de farmácias (para agendamento de reuniões)
- **Não aparecem** no ranking de scraping / KPIs de atendimento (pois não têm coletas)
- **Aparecem** no módulo de Reuniões normalmente
- O frontend pode filtrar usando `tem_chatbot` quando necessário

Sugestão: adicionar um filtro toggle na lista:
```
[Todas]  [Com ChatBot]  [Sem ChatBot]
```

---

## Deploy

### 1. Rodar a migration no servidor
```bash
# No servidor (SSH)
psql $DATABASE_URL -f /opt/pharmaflow/pharmaflow-node/migrations/0005_add_tem_chatbot.sql
```

### 2. Rebuild do backend
```bash
# Local
cd pharmaflow-node
npm run build
git add -A
git commit -m "feat: campo tem_chatbot + cadastro farmácia sem chatbot"
git push

# No servidor
cd /opt/pharmaflow
git pull
docker compose up --build -d
```

### 3. Verificar
```bash
curl -s https://api.pharmarelatorios.online/api/farmacias \
  -H "Authorization: Bearer SEU_TOKEN" | jq '.[0].tem_chatbot'
# Deve retornar: true (ou false para as sem chatbot)
```

---

## Checklist Frontend

- [ ] Adicionar `tem_chatbot` ao tipo `Farmacia` no TypeScript
- [ ] Adicionar toggle "Sem ChatBot" no modal de cadastro
- [ ] Ocultar campos URL/email/senha quando `tem_chatbot = false`
- [ ] Adicionar badge visual na lista de farmácias
- [ ] (Opcional) Adicionar filtro "Com ChatBot / Sem ChatBot" na listagem
- [ ] Inicializar `tem_chatbot: true` ao abrir modal de nova farmácia
- [ ] Preencher `tem_chatbot` ao abrir modal de edição (puxar do dado existente)
