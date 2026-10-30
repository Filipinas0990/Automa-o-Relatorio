import type { InstanciaStatus } from './DisparoRepository';

export interface GrupoWhatsApp {
  jid:           string;   // ...@g.us
  nome:          string;
  participantes: number | null;
}

/** Resposta da listagem de grupos: a lista + o estado do cache por trás. */
export interface ListagemGrupos {
  grupos:        GrupoWhatsApp[];
  /** Quando o cache foi sincronizado (null = conexão sem instância). */
  atualizadoEm:  Date | null;
  /** true = tem um refresh rodando em background; vale reconsultar em breve. */
  sincronizando: boolean;
  /** Erro do último sync, quando ele falhou mas ainda temos cache para mostrar. */
  aviso:         string | null;
}

export interface OpcoesListagem {
  /** Ignora o cache e espera a Evolution responder (botão "Atualizar"). */
  forcar?: boolean;
}

/** Conexão que pode originar um disparo — a do gestor ou uma global. */
export interface ConexaoDisparo {
  instanceName: string;
  nome:         string;
  tipo:         'gestor' | 'global';
  status:       InstanciaStatus;
  numero:       string | null;
}

export interface GrupoSelecionado {
  jid:  string;
  nome: string;
}

/** Um criativo do disparo. Um pedido de oferta gera vários. */
export interface MidiaDisparo {
  b64:     string;   // base64 puro, sem o prefixo data:
  mime:    string;
  rotulo?: string;   // vira a legenda da imagem (ex.: "Dipirona — R$ 9,90")
}

/** Resultado de um grupo, como o campanhas devolve no callback. */
export interface ResultadoGrupo {
  jid:    string;
  nome?:  string;
  status: 'ok' | 'erro';
  erro?:  string | null;
}

/**
 * Retorno do executarDisparo: 'direto' já traz o resultado (envio síncrono);
 * 'campanhas' só confirma que foi enfileirado — o resultado chega no callback.
 */
export type ResultadoDisparo =
  | { modo: 'direto';    enviados: number; falhas: number }
  | { modo: 'campanhas'; grupos: number };
