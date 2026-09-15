# Tela de Login — Como é feita tecnicamente

## Visão Geral

A tela de login é composta por **uma página principal** (`pages/Login/index.tsx`) que orquestra todos os elementos visuais e de lógica. Ela usa **React + styled-components** e não depende de nenhuma biblioteca de UI externa — tudo é construído do zero.

---

## 1. A Imagem de Fundo

### Como funciona
O fundo da tela é uma imagem `.webp` carregada dinamicamente. O sistema escolhe **automaticamente qual imagem exibir com base na data atual**.

### Localização das imagens
Todas as imagens ficam em:
```
web-pharmachatbot/public/themes/login/
```

### Imagens disponíveis

| Arquivo | Quando aparece |
|---|---|
| `copa.webp` | 01/06 até 19/07 (Copa do Mundo 2026) |
| `halloween.webp` | 15 dias antes até 15 dias depois de 31/10 |
| `natal.webp` | 10/12 até 27/12 |
| `anonovo.webp` | 28/12 até 16/01 |
| `pascoa.webp` | 15 dias antes até 15 dias depois da Páscoa (calculada pelo algoritmo de Meeus) |
| `aniversario.webp` | Fevereiro inteiro |
| `default.webp` | Todos os outros períodos |
| `mobile.webp` | Versão mobile da imagem padrão |

> Cada tema tem também uma versão `cyborg-*.webp` para o modo "Cyborg" da plataforma (controlado pela variável de ambiente `VITE_APP=CYBORG`).

### Como o sistema escolhe a imagem
```typescript
// assets/loginBackgroundLink.ts
const loginBackgroundLink = [
  { name: 'Copa', image: '/themes/login/copa.webp', active: isWorldCupSeason() },
  { name: 'Halloween', image: '/themes/login/halloween.webp', active: isHalloweenSeason() },
  // ...
  { name: 'Padrão', image: '/themes/login/default.webp', active: true }, // sempre ativo como fallback
];

// Pega o primeiro item com active=true
const getActiveLoginBackground = () => loginBackgroundLink.find(bg => bg.active);
```

A lógica de datas fica em `assets/seasonal.ts`.

### Como a imagem é aplicada no CSS
```typescript
// style.ts
const Container = styled.main<{ image: string; mobileImage: string }>`
  background-image: url(${({ image }) => image});
  background-size: cover;
  background-position: center;

  @media (max-width: 640px) {
    background-image: url(${({ mobileImage }) => mobileImage});
  }
`;
```

### Fallback quando não há imagem sazonal
Se não houver imagem sazonal ativa, o sistema usa `system.background_login` — uma URL de imagem configurada no banco de dados da empresa (tabela `systems` ou similar). Se essa também não existir, o fundo fica `#f8f9fa` (cinza claro).

---

## 2. O Card de Login (Efeito de Virada 3D)

### Estrutura
O card usa um efeito **CSS 3D flip** — o card gira como uma carta de baralho ao clicar em "Esqueci minha senha".

```
CardScene (perspectiva 3D: 1600px)
  └── CardFlipper (rotaciona: 0deg ↔ 180deg, transição 0.85s)
        ├── LoginCard (frente do card — face normal)
        └── RecoveryFace (verso do card — face da recuperação de senha)
```

### CSS do efeito 3D
```typescript
// Cena 3D
const CardScene = styled.div`
  perspective: 1600px;  /* Define a profundidade 3D */
  width: 100%;
  max-width: 37rem;
  height: 40rem;
`;

// O container que gira
const CardFlipper = styled.div<{ flipped: boolean }>`
  transform-style: preserve-3d;
  transition: transform 0.85s cubic-bezier(0.65, 0, 0.35, 1);
  transform: ${({ flipped }) => flipped ? 'rotateY(180deg)' : 'rotateY(0deg)'};
`;

// O verso fica pré-rotacionado 180deg
const RecoveryFace = styled.section`
  transform: rotateY(180deg);
  backface-visibility: hidden; /* esconde quando está de costas */
`;
```

### Glassmorphism (efeito de vidro fosco)
O card tem o visual de vidro translúcido que aparece sobre a foto de fundo:
```css
background: rgba(255, 255, 255, 0.18);   /* branco transparente */
backdrop-filter: blur(18px) saturate(180%);  /* desfoca o fundo */
border: 1px solid rgba(255, 255, 255, 0.4);  /* borda translúcida */
box-shadow: 0 24px 60px rgba(15, 15, 30, 0.12);  /* sombra suave */
border-radius: 1.5rem;
```

---

## 3. O Logo da Empresa

```tsx
// Tenta usar o logo configurado no banco (system.logo_login)
// Se não existir, usa o logo padrão do sistema
const logoSrc = system?.logo_login
  ? `${system.logo_login}?lastmod=${system?.version ?? ''}`
  : chatbotLogo; // fallback: assets/chatbot_logo.png

<CompanyLogo src={logoSrc} alt="Logo do sistema" />
```

O `?lastmod=` no final da URL é um cache-buster — força o navegador a recarregar o logo quando a versão muda.

---

## 4. O Título Animado (Efeito de Máquina de Escrever)

Usa a biblioteca **`typewriter-effect`**:

```tsx
<Typewriter
  options={{
    strings: [
      '<strong>Bem-vindo</strong> de volta!',
      'É muito bom ter você <strong>aqui!</strong>',
    ],
    autoStart: true,
    loop: true,        // repete infinitamente
    delay: 55,         // velocidade de digitar (ms por letra)
    deleteSpeed: 30,   // velocidade de apagar
    cursor: '|',
  }}
/>
```

A palavra em destaque (vermelho) usa `<strong>` que recebe a cor `var(--color-primary-base)` via CSS.

---

## 5. O Formulário de Login

### Biblioteca: `react-hook-form`
O formulário usa `react-hook-form` com `Controller` para integrar os campos.

### Campos

**E-mail:**
- Ícone: `Mail` (lucide-react)
- Validação: obrigatório + regex de e-mail
- Erro inline abaixo do campo

**Senha:**
- Ícone: `Lock` (lucide-react)
- Botão de mostrar/ocultar senha (ícone `Eye` / `EyeOff`)
- Erro inline: mostra erro de campo OU erro retornado pelo servidor

### Estados do botão "Entrar"

| Estado | Visual | Quando ocorre |
|---|---|---|
| `idle` | Ícone → + "Entrar" | Inicial |
| `loading` | Spinner girando + "Entrando..." | Aguardando resposta da API |
| `success` | Check ✓ + "Bem-vindo!" | Login OK |
| `error` | X + "Falha no login" | Credenciais erradas |

Após erro, o botão volta para `idle` automaticamente em **1800ms**.

### Ícones usados
Todos os ícones do formulário vêm da biblioteca `lucide-react`:
- `Mail`, `Lock`, `Eye`, `EyeOff` → campos
- `ArrowRight`, `Loader2`, `Check`, `X` → estados do botão

---

## 6. "Esqueci minha senha" (RecoveryCard)

Ao clicar, o card **gira 180° no eixo Y** revelando o `RecoveryCard` (verso do card). Ao clicar em "Voltar", gira de volta para o login.

O estado do flip é gerenciado com um simples `useState`:
```tsx
const [isFlipped, setIsFlipped] = useState(false);
// botão "Esqueci": setIsFlipped(true)
// botão "Voltar": setIsFlipped(false)
```

---

## 7. Rodapé (Copyright)

```tsx
<Copyright>
  <span>{`${system?.name} @ ${new Date().getFullYear()} - v${packageJson.version}`}</span>
  <section>
    {whatsappUrl && <a href={whatsappUrl}><IconButton icon="whatsapp" /></a>}
    {facebookUrl && <a href={facebookUrl}><IconButton icon="facebook" /></a>}
    {instagramUrl && <a href={instagramUrl}><IconButton icon="instagram" /></a>}
  </section>
</Copyright>
```

- Nome da empresa + ano + versão do package.json
- Links de WhatsApp, Facebook e Instagram (só aparecem se estiverem configurados no banco)
- Fundo translúcido com `backdrop-filter: blur(8px)` para legibilidade sobre a foto

---

## 8. Modais de Erro Especiais

Alguns erros de login **não aparecem no formulário** — abrem um modal:

| Modal | Quando abre |
|---|---|
| `NoModulesModal` | Empresa sem módulos ativos |
| `InactiveCompanyModal` | Empresa inativa |

Os outros erros (senha errada, e-mail não verificado, etc.) aparecem como texto vermelho dentro do formulário.

---

## 9. Resumo: O que você precisa para recriar

### Imagens obrigatórias
```
public/themes/login/
├── default.webp      ← imagem de fundo padrão (OBRIGATÓRIA)
├── mobile.webp       ← versão mobile (OBRIGATÓRIA)
├── copa.webp         ← Copa 2026 (opcional, ativa 01/06-19/07)
├── halloween.webp    ← Halloween (opcional)
├── natal.webp        ← Natal (opcional)
├── anonovo.webp      ← Ano Novo (opcional)
├── pascoa.webp       ← Páscoa (opcional)
└── aniversario.webp  ← Aniversário da empresa = fevereiro (opcional)
```

**A IA reclama das fotos porque o sistema espera que esses arquivos existam em `public/themes/login/`. Basta colocar qualquer imagem `.webp` com esses nomes que funciona.**

### Dependências npm necessárias
```
typewriter-effect   ← animação de texto
react-hook-form     ← formulário
lucide-react        ← ícones
styled-components   ← estilos
```

### Dados do banco que alimentam a tela
| Campo | De onde vem | Efeito na tela |
|---|---|---|
| `system.logo_login` | Tabela `systems` | Logo exibido no card |
| `system.background_login` | Tabela `systems` | Imagem de fundo alternativa |
| `system.name` | Tabela `systems` | Nome no rodapé |
| `system.url_whatsapp` | Tabela `systems` | Ícone WhatsApp no rodapé |
| `system.url_facebook` | Tabela `systems` | Ícone Facebook no rodapé |
| `system.url_instagram` | Tabela `systems` | Ícone Instagram no rodapé |
| `system.version` | Tabela `systems` | Cache-buster do logo |
