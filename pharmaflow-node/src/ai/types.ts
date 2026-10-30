// Dados extraídos pela IA a partir da mensagem do gestor no WhatsApp

export interface CampanhaExtraida {
  clienteNome:    string | null;   // "Loja da Maria"
  objetivo:       string | null;   // "CONVERSIONS" | "LINK_CLICKS" | "REACH" ...
  orcamentoDiario: number | null;  // em centavos (R$ 50,00 → 5000)
  publico: {
    genero:       'ALL' | 'MALE' | 'FEMALE' | null;
    idadeMin:     number | null;
    idadeMax:     number | null;
    localizacao:  string | null;   // "São Paulo, SP" ou similar
  };
  dataInicio:     string | null;   // "YYYY-MM-DD"
  dataFim:        string | null;   // "YYYY-MM-DD"
  copy:           string | null;   // texto do anúncio
  // true se tiver imagem/vídeo anexado na mensagem
  temMidia:       boolean;
  // campos faltando para poder criar a campanha
  camposFaltando: string[];
}

export interface MensagemInterpretada {
  tipo:      'campanha' | 'confirmacao' | 'cancelamento' | 'listagem_clientes' | 'outro';
  campanha?: CampanhaExtraida;
  respostaSugerida: string;
}
