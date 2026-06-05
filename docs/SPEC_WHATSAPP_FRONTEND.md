# SPEC — Módulo WhatsApp (Integração Evolution API)

**Versão:** 1.0  
**Data:** 2026-06-05  
**Backend base URL:** `https://api.pharmarelatorios.online`  
**Autenticação:** Bearer JWT em todos os endpoints (exceto `/webhook`)

---

## 1. Visão Geral

O módulo WhatsApp permite que o administrador **conecte um número de WhatsApp** ao sistema via QR code usando a Evolution API. Uma vez conectado, o sistema passa a enviar automaticamente uma **mensagem de confirmação 5 horas antes de cada reunião agendada**, para o telefone cadastrado na farmácia.

### Onde fica no frontend

A tela de configuração deve ficar em **Configurações → WhatsApp** (ou equivalente), acessível **somente para administradores**. O status de conexão pode ser exibido também como um badge no menu lateral.

### Resumo do fluxo

```
Admin abre "Configurações WhatsApp"
       ↓
Verifica status atual  →  [Conectado]  →  Exibe número + botão "Desconectar"
       ↓
  [Desconectado]
       ↓
Admin informa nome da instância + clica "Conectar"
       ↓
Backend cria instância na Evolution API e retorna QR code base64
       ↓
Frontend exibe QR code + inicia polling a cada 3s em /qrcode
       ↓
Usuário escaneia com o celular
       ↓
Polling detecta status "open"  →  Exibe tela de sucesso "Conectado!"
```

---

## 2. Endpoints

### 2.1 `GET /api/whatsapp/status`

Retorna o estado atual da conexão. **Chame sempre que a tela abrir.**

**Headers:**
```
Authorization: Bearer <token>
```

**Resposta — sem instância configurada:**
```json
{
  "conectado":    false,
  "status":       "close",
  "instancia":    null,
  "numero":       null,
  "configurado":  true
}
```

**Resposta — conectado:**
```json
{
  "conectado":    true,
  "status":       "open",
  "instancia":    "pharmaflow-prod",
  "numero":       "5511999999999",
  "configurado":  true
}
```

**Resposta — EVOLUTION_API_URL não configurada no servidor:**
```json
{
  "conectado":    false,
  "status":       "close",
  "instancia":    null,
  "numero":       null,
  "configurado":  false
}
```
> Se `configurado: false`, exiba um alerta de erro de servidor (não é culpa do usuário).

**Valores possíveis de `status`:**

| Valor | Significado |
|---|---|
| `open` | WhatsApp conectado e funcionando |
| `connecting` | Aguardando escaneamento do QR code |
| `close` | Desconectado |

---

### 2.2 `POST /api/whatsapp/connect`

Cria a instância na Evolution API e retorna o QR code para escaneamento.  
**Somente admin.**

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Body:**
```json
{
  "instance_name": "pharmaflow-prod"
}
```

> `instance_name` é o identificador da instância na Evolution API. Pode ser qualquer string sem espaços. Sugestão: deixar um campo de texto com valor padrão `"pharmaflow"` e permitir que o admin personalize.

**Resposta 200 — sucesso:**
```json
{
  "instancia":  "pharmaflow-prod",
  "status":     "connecting",
  "qr_code":    "data:image/png;base64,iVBORw0KGgoAAAANSUhEU..."
}
```

> O campo `qr_code` já vem no formato `data:image/png;base64,...`, pronto para usar em `<img src={qr_code} />`.  
> Se vier `null`, a instância foi criada mas o QR ainda não está disponível — inicie o polling.

**Resposta 400:**
```json
{ "detail": "Campo \"instance_name\" é obrigatório." }
```

**Resposta 503 — Evolution API não configurada no servidor:**
```json
{ "detail": "Evolution API não configurada no servidor. Defina EVOLUTION_API_URL e EVOLUTION_API_KEY." }
```

**Resposta 502 — erro de rede com a Evolution API:**
```json
{ "detail": "Não foi possível conectar à Evolution API. Verifique as credenciais." }
```

---

### 2.3 `GET /api/whatsapp/qrcode`

Retorna o QR code atualizado e o status ao vivo. **Use para polling.**

**Headers:**
```
Authorization: Bearer <token>
```

**Resposta — aguardando escaneamento:**
```json
{
  "status":    "connecting",
  "qr_code":   "data:image/png;base64,iVBORw0KGgoAAAANSUhEU...",
  "instancia": "pharmaflow-prod"
}
```

**Resposta — conectado (QR escaneado com sucesso):**
```json
{
  "status":    "open",
  "qr_code":   null,
  "instancia": "pharmaflow-prod"
}
```

> Quando `status === "open"`, pare o polling e exiba a tela de sucesso.

**Resposta 404 — nenhuma instância configurada:**
```json
{ "detail": "Nenhuma instância configurada. Chame POST /api/whatsapp/connect primeiro." }
```

---

### 2.4 `DELETE /api/whatsapp/disconnect`

Desconecta o WhatsApp (logout do número), mas mantém a instância configurada.  
**Somente admin.**

**Headers:**
```
Authorization: Bearer <token>
```

**Resposta 200:**
```json
{ "mensagem": "WhatsApp desconectado com sucesso." }
```

> Após desconectar, o admin pode reconectar escaneando um novo QR code via `POST /connect`.

---

### 2.5 `DELETE /api/whatsapp/instance`

Remove completamente a instância da Evolution API e do banco de dados.  
Use quando quiser trocar de instância ou apagar tudo.  
**Somente admin.**

**Headers:**
```
Authorization: Bearer <token>
```

**Resposta 200:**
```json
{ "mensagem": "Instância removida completamente." }
```

---

### 2.6 `POST /api/whatsapp/webhook` *(backend only — não chamar do frontend)*

Endpoint chamado automaticamente pela Evolution API quando o status muda (QR escaneado, desconexão inesperada, etc.). O frontend **não deve chamar este endpoint** — ele é exclusivo para uso da Evolution API.

---

## 3. Máquina de Estados da UI

```
                    ┌─────────────────┐
           [abriu]  │                 │
         ──────────►│   VERIFICANDO   │
                    │  (GET /status)  │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
        status=open    status=close   configurado=false
              │              │              │
              ▼              ▼              ▼
         ┌─────────┐  ┌───────────┐  ┌──────────────┐
         │CONECTADO│  │DESCONECTA-│  │ERRO SERVIDOR │
         │         │  │    DO     │  │              │
         └────┬────┘  └─────┬─────┘  └──────────────┘
              │             │
      [Desconectar]   [Conectar]
              │             │
              ▼             ▼
         ┌─────────┐  ┌────────────────┐
         │ LOGOUT  │  │  FORMULÁRIO    │
         │(DELETE  │  │ instance_name  │
         │/disconn)│  │  + [Conectar]  │
         └────┬────┘  └───────┬────────┘
              │               │
              │        [POST /connect]
              │               │
              ▼               ▼
         DESCONECTADO  ┌─────────────────┐
                       │  EXIBINDO QR    │
                       │  (polling 3s)   │
                       │  GET /qrcode    │
                       └───────┬─────────┘
                               │
                    ┌──────────┴──────────┐
                    │                     │
              status=open           timeout (2min)
                    │                     │
                    ▼                     ▼
              ┌──────────┐         ┌────────────┐
              │ SUCESSO! │         │  QR EXPI-  │
              │Conectado │         │  RADO      │
              └──────────┘         └────────────┘
```

---

## 4. Lógica de Polling

```typescript
// Inicie o polling DEPOIS de receber resposta de POST /connect
// Pare quando status = "open" ou após 2 minutos (QR expira)

const MAX_TENTATIVAS = 40; // 40 × 3s = 2 minutos

async function iniciarPollingQrCode(
  onConectado: () => void,
  onExpirado:  () => void,
) {
  let tentativas = 0;

  const intervalo = setInterval(async () => {
    tentativas++;

    if (tentativas > MAX_TENTATIVAS) {
      clearInterval(intervalo);
      onExpirado();
      return;
    }

    try {
      const res  = await fetch('/api/whatsapp/qrcode', { headers: authHeaders() });
      const data = await res.json();

      if (data.status === 'open') {
        clearInterval(intervalo);
        onConectado();
        return;
      }

      // Atualiza a imagem do QR se mudou
      if (data.qr_code) {
        setQrCode(data.qr_code);
      }
    } catch {
      // ignora erros de rede durante polling
    }
  }, 3000);

  return () => clearInterval(intervalo); // cleanup
}
```

---

## 5. Componentes Sugeridos

### 5.1 `<WhatsAppSettings />` — Tela principal

```
┌─────────────────────────────────────────────────────┐
│  WhatsApp                                           │
│  Notificações automáticas de reunião                │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Status:  ● Conectado                               │
│  Número:  +55 11 99999-9999                         │
│  Instância: pharmaflow-prod                         │
│                                                     │
│  As farmácias receberão uma mensagem de WhatsApp    │
│  5 horas antes de cada reunião agendada.            │
│                                                     │
│  [  Desconectar  ]                                  │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Estados do badge de status:**

| Status | Cor | Texto |
|---|---|---|
| `open` | Verde `#10B981` | ● Conectado |
| `connecting` | Amarelo `#F59E0B` | ● Conectando... |
| `close` | Cinza `#6B7280` | ● Desconectado |

---

### 5.2 `<WhatsAppConnectModal />` — Modal de conexão

```
┌──────────────────────────────────────────────────┐
│  Conectar WhatsApp                          [✕]  │
├──────────────────────────────────────────────────┤
│                                                  │
│  Nome da instância                               │
│  ┌────────────────────────────────────────────┐  │
│  │ pharmaflow                                 │  │
│  └────────────────────────────────────────────┘  │
│  ℹ Identificador único na Evolution API.         │
│    Use letras, números e hífens.                 │
│                                                  │
│                  [ Conectar ]                    │
│                                                  │
└──────────────────────────────────────────────────┘
```

---

### 5.3 `<WhatsAppQrModal />` — Modal com QR code

```
┌──────────────────────────────────────────────────┐
│  Escaneie o QR Code                         [✕]  │
├──────────────────────────────────────────────────┤
│                                                  │
│  1. Abra o WhatsApp no celular                   │
│  2. Toque em Menu (⋮) → Aparelhos conectados     │
│  3. Toque em "Conectar um aparelho"              │
│  4. Aponte a câmera para o QR code abaixo        │
│                                                  │
│          ┌──────────────────────┐                │
│          │  ██ ▀▀ ██ ██ ▀▀ ██  │                │
│          │  ▀  ██ ▀▀ ▀▀ ██ ▀▀  │                │
│          │  ██ ▀▀ ██ ██ ▀▀ ██  │  ← <img>       │
│          │  ▀▀ ██ ▀▀ ▀▀ ██ ▀▀  │                │
│          └──────────────────────┘                │
│                                                  │
│  ⏱ O QR code expira em 2 minutos                │
│  [████████████████░░░░░] 1:32                    │
│                                                  │
│        [ Cancelar ]  [ Gerar novo QR ]           │
│                                                  │
└──────────────────────────────────────────────────┘
```

> O botão **"Gerar novo QR"** chama novamente `POST /connect` com o mesmo `instance_name`.

---

### 5.4 Tela de sucesso (após escaneamento)

```
┌──────────────────────────────────────────────────┐
│                                                  │
│                      ✅                           │
│              WhatsApp Conectado!                 │
│                                                  │
│   As reuniões agendadas já passarão a receber    │
│   confirmação automática 5h antes via WhatsApp.  │
│                                                  │
│                   [ Fechar ]                     │
│                                                  │
└──────────────────────────────────────────────────┘
```

---

## 6. Modelo da Mensagem Enviada

Esta é a mensagem que o responsável da farmácia recebe **5 horas antes da reunião**:

```
Olá, *João Silva*!

Lembrando que em *5 horas* temos nossa reunião agendada:

📋 *Análise de Resultados - Junho*
🏥 Farmácia Central Ltda
📅 05/06/2026 às 14:00
⏱️ Duração: 60 min
📍 Local: Google Meet
🔗 Link: https://meet.google.com/abc-defg-hij

Por favor, confirme sua presença. Até logo! 😊
```

> O campo `responsavel` e o `telefone` são cadastrados na tela de farmácias.  
> Se `responsavel` estiver vazio, a saudação será genérica ("Olá!").  
> Se `telefone` não estiver preenchido, a farmácia **não receberá** notificação.

---

## 7. Permissões

| Ação | Admin | Gestor |
|---|---|---|
| Ver status de conexão | ✅ | ✅ |
| Ver QR code (polling) | ✅ | ✅ |
| Conectar (criar instância) | ✅ | ❌ |
| Desconectar | ✅ | ❌ |
| Deletar instância | ✅ | ❌ |

---

## 8. Tratamento de Erros

| Código | Situação | O que mostrar |
|---|---|---|
| `400` | `instance_name` vazio | Erro inline no campo |
| `401` | Token expirado | Redirecionar para login |
| `403` | Gestor tentando conectar | "Apenas administradores podem configurar o WhatsApp." |
| `404` | Nenhuma instância (polling) | Parar polling, voltar à tela inicial |
| `502` | Evolution API inacessível | Toast: "Não foi possível conectar à Evolution API. Verifique as credenciais do servidor." |
| `503` | Variáveis de ambiente não definidas | Alerta: "O servidor não está configurado para WhatsApp. Contate o suporte técnico." |

---

## 9. Variáveis de Ambiente Necessárias no Servidor

> Esta seção é informativa — o frontend não precisa configurar nada. Em caso de erro `503`, repassar ao responsável técnico do backend.

```env
EVOLUTION_API_URL=https://sua-evolution-api.com   # URL base da instância Evolution API
EVOLUTION_API_KEY=sua-api-key                     # Global API Key do painel Evolution
EVOLUTION_WEBHOOK_SECRET=segredo-opcional         # Para validar eventos do webhook
```

---

## 10. Checklist de Implementação

- [ ] Tela `Configurações → WhatsApp` (somente admin no menu)
- [ ] Badge de status no menu lateral (verde/cinza)
- [ ] `GET /api/whatsapp/status` ao montar a tela
- [ ] Modal de conexão com campo `instance_name`
- [ ] `POST /api/whatsapp/connect` ao clicar "Conectar"
- [ ] Exibir QR code (`<img src={qr_code} />`)
- [ ] Polling `GET /api/whatsapp/qrcode` a cada 3 segundos
- [ ] Countdown visual de 2 minutos para expiração do QR
- [ ] Botão "Gerar novo QR" ao expirar
- [ ] Tela de sucesso ao detectar `status: "open"`
- [ ] `DELETE /api/whatsapp/disconnect` ao clicar "Desconectar"
- [ ] Confirmação antes de desconectar ("Tem certeza?")
- [ ] Tratamento de todos os códigos de erro listados na seção 8
- [ ] Verificar se `farmacias.telefone` está preenchido — exibir aviso se farmácias sem telefone
