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
  publico: {
    genero:       'ALL' | 'MALE' | 'FEMALE';
    idadeMin:     number;
    idadeMax:     number;
    localizacao:  string;
  };
  copy:           string;
  imagemUrl?:     string;        // URL da imagem já uploadada no Meta
  imagemHash?:    string;        // hash retornado após upload
}

export interface CampanhaCriada {
  campanhaId:    string;
  conjuntoId:    string;
  anuncioId:     string;
  linkGerenciador: string;
}
