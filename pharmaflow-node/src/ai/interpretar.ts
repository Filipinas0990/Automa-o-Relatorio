import OpenAI from 'openai';
import type { MensagemInterpretada } from './types';

// Cliente OpenAI criado sob demanda (lazy) — assim a app NÃO quebra ao subir
// quando não há OPENAI_API_KEY. Só é instanciado se o bot for realmente usado.
let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

const SYSTEM_PROMPT = `Você é um assistente especializado em criar campanhas no Meta Ads para gestores de tráfego de farmácias.

Retorne SEMPRE um JSON válido (sem markdown, sem blocos de código) com esta estrutura exata:
{
  "tipo": "campanha" | "confirmacao" | "cancelamento" | "listagem_clientes" | "outro",
  "campanha": {
    "clienteNome": string | null,
    "objetivo": "CONVERSIONS" | "LINK_CLICKS" | "REACH" | "LEAD_GENERATION" | null,
    "orcamentoDiario": number | null,
    "publico": {
      "genero": "ALL" | "MALE" | "FEMALE" | null,
      "idadeMin": number | null,
      "idadeMax": number | null,
      "localizacao": string | null
    },
    "dataInicio": "YYYY-MM-DD" | null,
    "dataFim": "YYYY-MM-DD" | null,
    "copy": string | null,
    "temMidia": boolean,
    "camposFaltando": string[]
  } | null,
  "respostaSugerida": string
}

REGRAS CRÍTICAS:
- Você tem acesso ao histórico completo da conversa — USE-O para acumular informações da campanha entre mensagens
- Se o gestor já informou o cliente numa mensagem anterior, mantenha no JSON mesmo que não repita agora
- "campanha": mensagem relacionada a criação de anúncio (mesmo que incompleta)
- "confirmacao": gestor responde SIM, OK, PODE, CONFIRMA, confirmar, yes, s
- "cancelamento": gestor responde NÃO, NAO, CANCELA, cancelar, não quero
- "listagem_clientes": gestor quer ver quais clientes estão disponíveis (ex: "quais clientes posso anunciar", "lista clientes", "quem eu posso subir campanha")
- "outro": saudações, perguntas genéricas não relacionadas a campanhas
- orcamentoDiario em centavos (R$10 → 1000, R$50 → 5000)
- dataInicio: se disser "hoje" use ${new Date().toISOString().slice(0, 10)}, se disser hora específica ainda use a data de hoje
- dataFim: se disser "sem data de término", "sem prazo", "indeterminado" → deixe null e NÃO coloque em camposFaltando
- genero: se disser "aberto", "todos", "qualquer um" → use "ALL"
- idadeMin/idadeMax: se disser "aberto", "todos", "qualquer idade" → use 18 e 65
- localizacao: aceita qualquer cidade/região mencionada
- camposFaltando: lista APENAS o que ainda falta e é obrigatório: clienteNome, objetivo, orcamentoDiario, dataInicio, copy
- dataFim, genero, idadeMin, idadeMax, localizacao são OPCIONAIS — não coloque em camposFaltando se não informados
- Se ainda há campos faltando em camposFaltando, pergunte APENAS pelo que falta, de forma objetiva
- Se camposFaltando estiver vazio [], a campanha está pronta para ser criada`;

export type HistoricoMensagem = {
  role: 'user' | 'assistant';
  content: string;
};

export async function interpretarMensagem(
  texto:         string,
  imagemBase64?: string,
  historico?:    HistoricoMensagem[],
): Promise<MensagemInterpretada> {
  const userContent: OpenAI.Chat.ChatCompletionContentPart[] = [];

  if (imagemBase64) {
    const dataUrl = imagemBase64.startsWith('data:')
      ? imagemBase64
      : `data:image/jpeg;base64,${imagemBase64}`;

    userContent.push({
      type:      'image_url',
      image_url: { url: dataUrl, detail: 'low' },
    });
  }

  userContent.push({
    type: 'text',
    text: texto || '(mensagem sem texto, apenas imagem)',
  });

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
  ];

  // Injeta o histórico da conversa (sem as imagens antigas, só texto)
  if (historico && historico.length > 0) {
    for (const h of historico) {
      messages.push({ role: h.role, content: h.content });
    }
  }

  messages.push({ role: 'user', content: userContent });

  const response = await getOpenAI().chat.completions.create({
    model:       'gpt-4o',
    messages,
    max_tokens:  1024,
    temperature: 0,
  });

  const raw = response.choices[0].message.content ?? '{}';
  return JSON.parse(raw) as MensagemInterpretada;
}
