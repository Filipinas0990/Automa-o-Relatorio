import OpenAI from 'openai';
import { logger } from '../logger';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface CopyGerada {
  textoPrincipal: string;
  titulo: string;
  descricao: string;
}

const SYSTEM = `Você é um redator publicitário especialista em anúncios de farmácia no Meta Ads (Facebook/Instagram).
Escreva copy curta, persuasiva e em português do Brasil, focada em oferta e economia, com no máximo 1 emoji.
Retorne SEMPRE um JSON válido (sem markdown) com EXATAMENTE estas chaves:
{
  "textoPrincipal": string,  // texto principal do anúncio, até 600 caracteres, pode ter quebras de linha
  "titulo": string,          // título curto (headline), até 40 caracteres
  "descricao": string        // descrição curta, até 60 caracteres
}`;

/**
 * Gera a copy do anúncio a partir dos produtos/objetivo. UMA chamada de IA por campanha.
 * Usada apenas na publicação, quando o gestor não escreveu a copy manualmente.
 */
export async function gerarCopyIA(dados: {
  produtos: string[];
  objetivo: string;
  farmacia?: string;
}): Promise<CopyGerada> {
  const produtos = dados.produtos.length ? dados.produtos.join(', ') : 'produtos em oferta';
  const userMsg =
    `Crie a copy para uma campanha de ${dados.objetivo} da farmácia "${dados.farmacia ?? 'a farmácia'}".\n` +
    `Produtos em destaque: ${produtos}.`;

  const resp = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: userMsg },
    ],
    max_tokens: 500,
    temperature: 0.7,
    response_format: { type: 'json_object' },
  });

  const raw = resp.choices[0].message.content ?? '{}';
  try {
    const j = JSON.parse(raw) as Partial<CopyGerada>;
    return {
      textoPrincipal: (j.textoPrincipal ?? '').slice(0, 600),
      titulo:         (j.titulo ?? '').slice(0, 40),
      descricao:      (j.descricao ?? '').slice(0, 60),
    };
  } catch (e) {
    logger.error({ err: e, raw }, 'Falha ao parsear copy da IA');
    // fallback determinístico se a IA retornar algo inválido
    return {
      textoPrincipal: `Ofertas especiais em ${produtos}! Aproveite e cuide da sua saúde. 💊`,
      titulo:         'Ofertas na sua farmácia',
      descricao:      'Preços que cabem no seu bolso.',
    };
  }
}
