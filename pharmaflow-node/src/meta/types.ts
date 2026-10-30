// Tipos usados na integração com a Meta Marketing API

export interface MetaToken {
  farmaciaId:    number;
  adAccountId:   string;         // "act_XXXXXXXXX"
  pageId:        string;         // ID da página do Facebook
  // access_token vem de META_ACCESS_TOKEN no env (System User do Business Manager)
  accessToken:   string;
}

export interface CriarCampanhaInput {
  token:          MetaToken;
  nome:           string;
  objetivo:       string;        // OUTCOME_* (novo) ou CONVERSIONS/LINK_CLICKS/... (legado)
  orcamentoDiario: number;       // em centavos
  dataInicio:     string;        // YYYY-MM-DD
  dataFim:        string | null;  // YYYY-MM-DD ou null (sem data de término)
  status?:        'ACTIVE' | 'PAUSED';  // padrão PAUSED (não quebra fluxos existentes)
  whatsapp?:      boolean;              // true = anúncio Click-to-WhatsApp (destino = conversa)
  publico: {
    genero:       'ALL' | 'MALE' | 'FEMALE';
    idadeMin:     number;
    idadeMax:     number;
    // null = país inteiro (Brasil). Com cidade, o Meta exige a "key" (não aceita nome livre).
    localizacao:  { key: string; nome: string } | null;
    raioKm:       number;   // só usado quando há cidade selecionada
    // undefined/"todas"/"todos" = deixa o Meta escolher sozinho (Advantage+ placements).
    plataforma?:     'todas' | 'instagram' | 'facebook';
    posicionamento?: 'todos' | 'feed' | 'story' | 'feed_story' | 'story_reels';
  };
  copy:           string;
  imagemUrl?:     string;        // URL da imagem já uploadada no Meta
  imagemHash?:    string;        // legado: 1 criativo só → 1 anúncio
  // Novo: N criativos → N anúncios no MESMO conjunto (o Meta rotaciona e
  // entrega mais o que performa melhor). Tem prioridade sobre imagemHash.
  criativos?:     Array<{ creativeId: string; rotulo: string; nomeAnuncio?: string | null }>;
}

export interface CampanhaCriada {
  campanhaId:    string;
  conjuntoId:    string;
  anuncioId:     string;    // 1º anúncio — mantido para os fluxos legados
  anuncioIds:    string[];  // todos os anúncios criados
  linkGerenciador: string;
}
