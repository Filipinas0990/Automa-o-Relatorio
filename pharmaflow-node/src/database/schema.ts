import {
  pgTable, pgView, primaryKey,
  serial, integer, varchar, text, boolean, timestamp, date, numeric,
} from 'drizzle-orm/pg-core';

// ── Re-export para conveniência ───────────────────────────────────────────────
export type { InferSelectModel } from 'drizzle-orm';

// ── Tabelas ───────────────────────────────────────────────────────────────────

export const gestoresTrafego = pgTable('gestores_trafego', {
  id:                   serial('id').primaryKey(),
  nome:                 varchar('nome',       { length: 120 }).notNull(),
  email:                varchar('email',      { length: 120 }).notNull().unique(),
  senhaHash:            varchar('senha_hash', { length: 255 }).notNull(),
  isAdmin:              boolean('is_admin').default(false).notNull(),
  ativo:                boolean('ativo').default(true),
  criadoEm:             timestamp('criado_em', { withTimezone: true }).defaultNow(),
  // Google Calendar OAuth (adicionado pela migration 0003)
  googleRefreshToken:    text('google_refresh_token'),
  googleCalendarId:      varchar('google_calendar_id',    { length: 255 }).default('primary'),
  // Número WhatsApp do gestor (formato: 5511999999999) — identifica quem manda msg
  telefoneWhatsapp:      varchar('telefone_whatsapp',     { length: 20  }).unique(),
  // Facebook do gestor (migration 0037). Token CRIPTOGRAFADO; nunca sai na API.
  metaAccessToken:       text('meta_access_token'),
  metaTokenExpiraEm:     timestamp('meta_token_expira_em', { withTimezone: true }),
  metaUsuarioId:         varchar('meta_usuario_id',   { length: 40 }),
  metaUsuarioNome:       varchar('meta_usuario_nome', { length: 120 }),
});

export const farmacias = pgTable('farmacias', {
  id:          serial('id').primaryKey(),
  // Razão social — nome jurídico, uso interno.
  nome:        varchar('nome', { length: 120 }).notNull(),
  // Nome de fachada (migration 0025): é o que o cliente final vê no criativo
  // e na mensagem do grupo. Null nos cadastros antigos — quem lê usa
  // `nomeVisivel()`, que cai na razão social enquanto não for preenchido.
  nomeFachada: varchar('nome_fachada', { length: 120 }),
  gestorId:    integer('gestor_id').references(() => gestoresTrafego.id),
  ativa:       boolean('ativa').default(true),
  temChatbot:  boolean('tem_chatbot').default(true).notNull(),
  // 'entrada' = cliente novo, ainda em implantação; 'ativo' = cliente acompanhado no painel
  fase:        varchar('fase', { length: 10 }).default('ativo').notNull(),
  telefone:    varchar('telefone',    { length: 20  }),
  responsavel: varchar('responsavel', { length: 120 }),
  cidade:      varchar('cidade',      { length: 100 }),
  observacoes: text('observacoes'),
  criadoEm:    timestamp('criado_em', { withTimezone: true }).defaultNow(),
  metaVendas:       integer('meta_vendas'),
  metaReceita:      numeric('meta_receita',       { precision: 15, scale: 2 }),
  metaLeadsGoogle:  integer('meta_leads_google'),
  metaLeadsMeta:    integer('meta_leads_meta'),
});

/**
 * Nome que pode aparecer para o cliente final: o de fachada, caindo na razão
 * social enquanto os cadastros antigos não forem completados (migration 0025).
 * Use isto em tudo que sai para fora — criativo, mensagem do grupo, link
 * público. Telas internas continuam mostrando a razão social.
 */
export function nomeVisivel(f: { nome: string; nomeFachada?: string | null }): string {
  return f.nomeFachada?.trim() || f.nome;
}

export const coletas = pgTable('coletas', {
  id:                   serial('id').primaryKey(),
  farmaciaId:           integer('farmacia_id').notNull().references(() => farmacias.id),
  dataColeta:           timestamp('data_coleta', { withTimezone: true }).defaultNow(),
  periodoInicio:        date('periodo_inicio').notNull(),
  periodoFim:           date('periodo_fim').notNull(),
  periodoDias:          integer('periodo_dias').default(7),
  clientesGoogle:       integer('clientes_google').default(0),
  clientesFacebook:     integer('clientes_facebook').default(0),
  clientesGruposOferta: integer('clientes_grupos_oferta').default(0),
  totalAtendimentos:    integer('total_atendimentos').default(0),
  vendasRealizadas:     integer('vendas_realizadas').default(0),
  receitaTotal:         numeric('receita_total',    { precision: 15, scale: 2 }).default('0'),
  variacaoGoogle:       numeric('variacao_google',  { precision: 8, scale: 2 }).default('0'),
  variacaoFacebook:     numeric('variacao_facebook',{ precision: 8, scale: 2 }).default('0'),
  variacaoGrupos:       numeric('variacao_grupos',  { precision: 8, scale: 2 }).default('0'),
  variacaoVendas:       numeric('variacao_vendas',  { precision: 8, scale: 2 }).default('0'),
  variacaoReceita:      numeric('variacao_receita', { precision: 8, scale: 2 }).default('0'),
  scoreCriticidade:     numeric('score_criticidade',{ precision: 5, scale: 2 }).default('0'),
  nivelAlerta:          varchar('nivel_alerta', { length: 10 }).default('verde').notNull(),
  atingiuMeta:          boolean('atingiu_meta').default(false).notNull(),
  atingiuMetaGoogle:    boolean('atingiu_meta_google'),
  atingiuMetaMeta:      boolean('atingiu_meta_meta'),
});

export const coletaCanais = pgTable('coleta_canais', {
  id:            serial('id').primaryKey(),
  coletaId:      integer('coleta_id').notNull().references(() => coletas.id),
  canal:         varchar('canal', { length: 80 }).notNull(),
  atendimentos:  integer('atendimentos').default(0),
  vendas:        integer('vendas').default(0),
  receitaVendas: numeric('receita_vendas', { precision: 15, scale: 2 }).default('0'),
});

// ── Views (existem no banco — só mapeamos para usar com sql``) ────────────────

export const vwRankingAtual = pgView('vw_ranking_atual', {
  farmaciaId:        integer('farmacia_id'),
  farmacia:          varchar('farmacia', { length: 120 }),
  nivelAlerta:       varchar('nivel_alerta', { length: 10 }),
  receitaTotal:      numeric('receita_total',      { precision: 15, scale: 2 }),
  totalAtendimentos: integer('total_atendimentos'),
  vendasRealizadas:  integer('vendas_realizadas'),
  variacaoReceita:   numeric('variacao_receita',   { precision: 8, scale: 2 }),
  variacaoVendas:    numeric('variacao_vendas',    { precision: 8, scale: 2 }),
  scoreCriticidade:  numeric('score_criticidade',  { precision: 5, scale: 2 }),
  posicaoRanking:    integer('posicao_ranking'),
  periodoDias:       integer('periodo_dias'),
  periodoInicio:     date('periodo_inicio'),
  periodoFim:        date('periodo_fim'),
  dataColeta:        timestamp('data_coleta', { withTimezone: true }),
}).existing();

export const vwEvolucaoSemanal = pgView('vw_evolucao_semanal', {
  farmaciaId:        integer('farmacia_id'),
  semanaNumero:      integer('semana_numero'),
  periodoDias:       integer('periodo_dias'),
  periodoInicio:     date('periodo_inicio'),
  periodoFim:        date('periodo_fim'),
  receitaTotal:      numeric('receita_total',     { precision: 15, scale: 2 }),
  vendasRealizadas:  integer('vendas_realizadas'),
  totalAtendimentos: integer('total_atendimentos'),
  scoreCriticidade:  numeric('score_criticidade', { precision: 5, scale: 2 }),
  nivelAlerta:       varchar('nivel_alerta', { length: 10 }),
}).existing();

// ── Reuniões com Gestores (adicionado pela migration 0003) ────────────────────

export const reunioes = pgTable('reunioes', {
  id:             serial('id').primaryKey(),
  farmaciaId:     integer('farmacia_id').notNull().references(() => farmacias.id),
  gestorId:       integer('gestor_id').references(() => gestoresTrafego.id),
  criadoPorId:    integer('criado_por_id').references(() => gestoresTrafego.id),

  titulo:         varchar('titulo',    { length: 200 }).notNull(),
  descricao:      text('descricao'),
  dataReuniao:    timestamp('data_reuniao', { withTimezone: true }).notNull(),
  duracaoMinutos: integer('duracao_minutos').default(60),
  local:          varchar('local',     { length: 300 }),
  linkMeet:       varchar('link_meet', { length: 500 }),

  // agendada | confirmada | realizada | cancelada
  status:         varchar('status', { length: 20 }).default('agendada').notNull(),

  // Telefone do contato que receberá a notificação WhatsApp 5h antes
  telefone:             varchar('telefone', { length: 20 }),

  googleEventId:        varchar('google_event_id', { length: 255 }),
  observacoes:          text('observacoes'),

  // Rastreia envio da notificação WhatsApp (5h antes) — null = ainda não enviada
  whatsappNotificadoEm: timestamp('whatsapp_notificado_em', { withTimezone: true }),

  criadoEm:       timestamp('criado_em',    { withTimezone: true }).defaultNow(),
  atualizadoEm:   timestamp('atualizado_em',{ withTimezone: true }).defaultNow(),
});

// ── Bloqueios de Agenda (adicionado pela migration 0004) ─────────────────────

export const agendaBloqueios = pgTable('agenda_bloqueios', {
  id:           serial('id').primaryKey(),
  data:         date('data').notNull(),
  horaInicio:   varchar('hora_inicio', { length: 5 }),   // "HH:MM" ou null
  horaFim:      varchar('hora_fim',    { length: 5 }),
  diaInteiro:   boolean('dia_inteiro').default(false).notNull(),
  motivo:       varchar('motivo', { length: 200 }),
  criadoPorId:  integer('criado_por_id').references(() => gestoresTrafego.id),
  criadoEm:     timestamp('criado_em', { withTimezone: true }).defaultNow(),
});

// ── WhatsApp Config (adicionado pela migration 0010) ─────────────────────────

export const whatsappConfig = pgTable('whatsapp_config', {
  id:              serial('id').primaryKey(),
  instanceName:    varchar('instance_name', { length: 100 }).notNull(),
  // Nome amigável da conexão (ex.: "WhatsApp Ofertas SP").
  nome:            varchar('nome', { length: 120 }),
  // open | close | connecting
  status:          varchar('status', { length: 20 }).default('close').notNull(),
  qrCode:          text('qr_code'),
  numeroConectado: varchar('numero_conectado', { length: 30 }),
  atualizadoEm:    timestamp('atualizado_em', { withTimezone: true }).defaultNow(),
});

// ── Ações de Marketing (adicionado pela migration 0008) ──────────────────────

export const acoes = pgTable('acoes', {
  id:            serial('id').primaryKey(),
  nome:          varchar('nome',           { length: 200 }).notNull(),
  tipo:          varchar('tipo',           { length: 80  }).notNull(),
  descricao:     text('descricao'),
  mesReferencia: varchar('mes_referencia', { length: 7   }).notNull(),
  // 'planejada' | 'em_andamento' | 'concluida' | 'cancelada'
  status:        varchar('status',         { length: 20  }).default('planejada').notNull(),
  cor:           varchar('cor',            { length: 7   }),
  criadoPorId:   integer('criado_por_id').references(() => gestoresTrafego.id),
  criadoEm:      timestamp('criado_em',    { withTimezone: true }).defaultNow(),
  atualizadoEm:  timestamp('atualizado_em',{ withTimezone: true }).defaultNow(),
});

export const farmaciaAcoes = pgTable('farmacia_acoes', {
  id:               serial('id').primaryKey(),
  acaoId:           integer('acao_id').notNull().references(() => acoes.id),
  farmaciaId:       integer('farmacia_id').notNull().references(() => farmacias.id),
  observacoes:      text('observacoes'),
  adicionadoEm:     timestamp('adicionado_em',    { withTimezone: true }).defaultNow(),
  adicionadoPorId:  integer('adicionado_por_id').references(() => gestoresTrafego.id),
});

// ── Meta Ads Tokens por cliente (adicionado pela migration 0012) ─────────────

// Configuração Meta por cliente — o access_token vem do env META_ACCESS_TOKEN (System User do BM)
export const metaTokens = pgTable('meta_tokens', {
  id:           serial('id').primaryKey(),
  farmaciaId:   integer('farmacia_id').notNull().unique().references(() => farmacias.id),
  adAccountId:  varchar('ad_account_id', { length: 60 }).notNull(),  // "act_XXXXX"
  pageId:       varchar('page_id',        { length: 60 }).notNull(),
  criadoEm:     timestamp('criado_em',    { withTimezone: true }).defaultNow(),
  atualizadoEm: timestamp('atualizado_em',{ withTimezone: true }).defaultNow(),
});

// ── Cache das contas de anúncio do Meta (migration 0032) ─────────────────────
//
// Retrato do que o token do System User enxerga em /me/adaccounts. Não é
// cadastro: quem sai do BM some daqui no próximo sync.
export const contasAnuncioCache = pgTable('contas_anuncio_cache', {
  id:             varchar('id', { length: 40 }).primaryKey(),   // "act_123456789"
  accountId:      varchar('account_id', { length: 40 }).notNull(),
  nome:           varchar('nome',    { length: 255 }).notNull(),
  cliente:        varchar('cliente', { length: 255 }).notNull().default(''),
  moeda:          varchar('moeda',   { length: 10 }).notNull().default(''),
  status:         varchar('status',  { length: 40 }).notNull().default(''),
  ativa:          boolean('ativa').notNull().default(false),
  temPagamento:   boolean('tem_pagamento').notNull().default(false),
  formaPagamento: text('forma_pagamento').notNull().default(''),
  atualizadoEm:   timestamp('atualizado_em', { withTimezone: true }).defaultNow().notNull(),
});

// Idade do cache. Linha única (id = 1): o token é um só e enxerga o mesmo
// conjunto de contas para todo mundo.
export const contasAnuncioCacheSync = pgTable('contas_anuncio_cache_sync', {
  id:             integer('id').primaryKey().default(1),
  sincronizadoEm: timestamp('sincronizado_em', { withTimezone: true }).defaultNow().notNull(),
  erro:           text('erro'),
});

// ── Campanhas criadas via automação WhatsApp (adicionado pela migration 0012) ─

export const campanhasMeta = pgTable('campanhas_meta', {
  id:              serial('id').primaryKey(),
  farmaciaId:      integer('farmacia_id').notNull().references(() => farmacias.id),
  gestorTelefone:  varchar('gestor_telefone', { length: 20 }).notNull(),
  // 'aguardando_confirmacao' | 'publicada' | 'cancelada' | 'erro'
  status:          varchar('status', { length: 30 }).default('aguardando_confirmacao').notNull(),
  payloadJson:     text('payload_json').notNull(),   // CampanhaExtraida serializada
  imagemBase64:    text('imagem_base64'),
  // IDs retornados pela Meta após criação
  metaCampanhaId:  varchar('meta_campanha_id', { length: 30 }),
  metaConjuntoId:  varchar('meta_conjunto_id', { length: 30 }),
  metaAnuncioId:   varchar('meta_anuncio_id',  { length: 30 }),
  criadoEm:        timestamp('criado_em',     { withTimezone: true }).defaultNow(),
  atualizadoEm:    timestamp('atualizado_em', { withTimezone: true }).defaultNow(),
});

// ── Catálogo de produtos com imagem PNG (fluxo Criativos e Campanhas) ─────────

export const catalogoProdutos = pgTable('catalogo_produtos', {
  id:           serial('id').primaryKey(),
  nome:         varchar('nome',      { length: 200 }).notNull(),
  // nome normalizado (sem acento, minúsculo) usado para o match com a planilha
  nomeNorm:     varchar('nome_norm', { length: 200 }).notNull(),
  // imagem PNG em base64 (sem o prefixo data:)
  imagemB64:    text('imagem_b64'),
  mime:         varchar('mime', { length: 40 }).default('image/png'),
  // produto desligado não entra no match de criativos nem é oferecido (migration 0018)
  ativo:        boolean('ativo').notNull().default(true),
  // Categoria em TEXTO LIVRE (migration 0030 — antes era slug de lista fechada).
  // NULL = sem categoria, estado de tudo que foi cadastrado antes da 0028.
  // O cadastro em catalogoCategorias é a lista oficial; aqui fica o texto.
  categoria:    varchar('categoria', { length: 60 }),
  criadoEm:     timestamp('criado_em',     { withTimezone: true }).defaultNow(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).defaultNow(),
});

// ── Cadastro de categorias do banco de imagens (migration 0031) ──────────────
// O vínculo com o produto é o TEXTO (catalogoProdutos.categoria), não um id:
// as três telas que filtram o acervo comparam por texto, e trocar isso por FK
// seria refatorá-las para ganhar integridade que a canonização já entrega.
// Consequência: renomear aqui faz UPDATE em cascata nos produtos, e excluir
// deixa os produtos sem categoria — ver src/catalogo/CatalogoService.ts.
export const catalogoCategorias = pgTable('catalogo_categorias', {
  id:           serial('id').primaryKey(),
  nome:         varchar('nome', { length: 60 }).notNull(),
  // Chave de unicidade: sem acento, minúscula, espaços colapsados.
  // Espelha normalizarCategoria() em src/catalogo/categorias.ts.
  nomeNorm:     varchar('nome_norm', { length: 60 }).notNull().unique(),
  criadoEm:     timestamp('criado_em',     { withTimezone: true }).defaultNow(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).defaultNow(),
});

// ── Disparo em grupos de WhatsApp (migrations 0015 e 0016) ───────────────────

// Instância Evolution por GESTOR — a ponte multi-tenant. Cada gestor de tráfego
// tem UMA conexão de WhatsApp, e é nela que ficam os grupos dos clientes dele.
// Não confundir com whatsappConfig, que é a instância única global usada nas
// notificações de reunião.
export const gestorWhatsapp = pgTable('gestor_whatsapp', {
  id:              serial('id').primaryKey(),
  gestorId:        integer('gestor_id').notNull().unique().references(() => gestoresTrafego.id),
  instanceName:    varchar('instance_name', { length: 100 }).notNull().unique(),
  // close | connecting | open
  status:          varchar('status', { length: 20 }).default('close').notNull(),
  numeroConectado: varchar('numero_conectado', { length: 30 }),
  qrCode:          text('qr_code'),
  criadoEm:        timestamp('criado_em',     { withTimezone: true }).defaultNow(),
  atualizadoEm:    timestamp('atualizado_em', { withTimezone: true }).defaultNow(),
});

export const disparosGrupo = pgTable('disparos_grupo', {
  id:           serial('id').primaryKey(),
  gestorId:     integer('gestor_id').notNull().references(() => gestoresTrafego.id),
  // Instância Evolution escolhida (null = usa a conexão do gestor).
  instanceName: varchar('instance_name', { length: 100 }),
  titulo:       varchar('titulo', { length: 200 }).notNull(),
  mensagem:     text('mensagem').notNull(),
  // JSON: [{ b64, mime, rotulo }] — um disparo leva vários criativos
  midiasJson:   text('midias_json'),
  // Onde o PRÓXIMO envio começa dentro de midias_json (migration 0033).
  // Disparo repetido manda 3 produtos por vez.
  cursorMidia:  integer('cursor_midia').default(0).notNull(),
  // true = a lista dá a volta ao acabar, e só a data de término encerra a
  // campanha. false = acabaram os produtos, acabou a campanha (migration 0035).
  repetirProdutos: boolean('repetir_produtos').default(false).notNull(),
  // JSON: [{ id, nome }] — quais produtos do catálogo geraram esses criativos.
  // Alimenta o filtro "Recentes" do passo 3 (migration 0029). Null nos antigos.
  produtosJson: text('produtos_json'),
  // de qual cliente/pedido veio (null = envio avulso, sem solicitação)
  farmaciaId:   integer('farmacia_id').references(() => farmacias.id),
  solicitacaoId: integer('solicitacao_id'),
  // JSON: [{ jid: "...@g.us", nome: "..." }]
  gruposJson:   text('grupos_json').notNull(),
  // agora | agendado
  quando:       varchar('quando', { length: 10 }).default('agora').notNull(),
  agendadoPara: timestamp('agendado_para', { withTimezone: true }),
  // nunca | diario | semanal | mensal
  repetir:      varchar('repetir', { length: 10 }).default('nunca').notNull(),
  // JSON: ["08:00","18:00"] — horários fixos do dia (migration 0023).
  // Null/vazio = um horário só, o de agendado_para.
  horariosJson: text('horarios_json'),
  // Fim da repetição (migration 0024). Null = até o gestor cancelar.
  repetirAte:   timestamp('repetir_ate', { withTimezone: true }),
  timezone:     varchar('timezone', { length: 50 }).default('America/Sao_Paulo').notNull(),
  // agendado | enviando | enviado | erro | cancelado
  status:       varchar('status', { length: 20 }).default('agendado').notNull(),
  proximoEnvio: timestamp('proximo_envio', { withTimezone: true }),
  ultimoEnvio:  timestamp('ultimo_envio',  { withTimezone: true }),
  criadoEm:     timestamp('criado_em',     { withTimezone: true }).defaultNow(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).defaultNow(),
});

export const disparosGrupoLog = pgTable('disparos_grupo_log', {
  id:         serial('id').primaryKey(),
  disparoId:  integer('disparo_id').notNull().references(() => disparosGrupo.id),
  grupoJid:   varchar('grupo_jid',  { length: 120 }).notNull(),
  grupoNome:  varchar('grupo_nome', { length: 200 }),
  // ok | erro
  status:     varchar('status', { length: 10 }).notNull(),
  erro:       text('erro'),
  enviadoEm:  timestamp('enviado_em', { withTimezone: true }).defaultNow(),
});

// ── Horários pré-definidos de disparo (migration 0022) ───────────────────────

// "HH:MM" como texto: é o formato do <input type="time"> e evita conversão de
// fuso entre banco, API e navegador.
export const horariosDisparo = pgTable('horarios_disparo', {
  id:        serial('id').primaryKey(),
  gestorId:  integer('gestor_id').notNull().references(() => gestoresTrafego.id),
  horario:   varchar('horario', { length: 5 }).notNull(),
  rotulo:    varchar('rotulo',  { length: 40 }),
  criadoEm:  timestamp('criado_em', { withTimezone: true }).defaultNow().notNull(),
});

// ── Cache dos grupos de WhatsApp (migration 0020) ────────────────────────────

// O fetchAllGroups da Evolution é lento demais para rodar a cada request; a
// listagem lê daqui e o refresh acontece em background.
export const gruposCache = pgTable('grupos_cache', {
  instanceName:  varchar('instance_name', { length: 100 }).notNull(),
  jid:           varchar('jid',  { length: 120 }).notNull(),
  nome:          varchar('nome', { length: 255 }).notNull(),
  participantes: integer('participantes'),
  atualizadoEm:  timestamp('atualizado_em', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.instanceName, t.jid] }),
}));

// Idade do cache por instância — separado porque uma conexão sem nenhum grupo
// também precisa registrar "já sincronizei".
export const gruposCacheSync = pgTable('grupos_cache_sync', {
  instanceName:   varchar('instance_name', { length: 100 }).primaryKey(),
  sincronizadoEm: timestamp('sincronizado_em', { withTimezone: true }).defaultNow().notNull(),
  erro:           text('erro'),
});

// ── Ofertas enviadas pelo dono da farmácia (migration 0017) ──────────────────

// Link público do gestor — o dono abre sem login, o token é a credencial.
export const linksOferta = pgTable('links_oferta', {
  id:           serial('id').primaryKey(),
  gestorId:     integer('gestor_id').notNull().references(() => gestoresTrafego.id),
  // Cliente dono deste link (migration 0021). NULL = link legado do gestor,
  // aquele em que o dono escolhia a farmácia numa lista.
  farmaciaId:   integer('farmacia_id').references(() => farmacias.id),
  token:        varchar('token', { length: 64 }).notNull().unique(),
  ativo:        boolean('ativo').default(true).notNull(),
  criadoEm:     timestamp('criado_em',     { withTimezone: true }).defaultNow(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).defaultNow(),
});

export const solicitacoesOferta = pgTable('solicitacoes_oferta', {
  id:             serial('id').primaryKey(),
  gestorId:       integer('gestor_id').notNull().references(() => gestoresTrafego.id),
  farmaciaId:     integer('farmacia_id').notNull().references(() => farmacias.id),
  // JSON: [{ id, nome }] — produtos do catálogo
  produtosJson:   text('produtos_json').notNull(),
  // Obrigatório (migration 0027): pedido de oferta não chega anônimo.
  enviadoPor:     varchar('enviado_por', { length: 120 }).notNull(),
  // pendente | atendida | descartada
  status:         varchar('status', { length: 20 }).default('pendente').notNull(),
  criadoEm:       timestamp('criado_em',   { withTimezone: true }).defaultNow(),
  atendidaEm:     timestamp('atendida_em', { withTimezone: true }),
});

// ── Tipos inferidos do schema (usados pela API) ────────────────────

export type Gestor          = typeof gestoresTrafego.$inferSelect;
export type Farmacia        = typeof farmacias.$inferSelect;
export type Coleta          = typeof coletas.$inferSelect;
export type Reuniao         = typeof reunioes.$inferSelect;
export type AgendaBloqueio  = typeof agendaBloqueios.$inferSelect;
export type Acao            = typeof acoes.$inferSelect;
export type FarmaciaAcao    = typeof farmaciaAcoes.$inferSelect;
export type WhatsAppConfig  = typeof whatsappConfig.$inferSelect;
export type MetaToken       = typeof metaTokens.$inferSelect;
export type CampanhaMeta    = typeof campanhasMeta.$inferSelect;
export type CatalogoProduto = typeof catalogoProdutos.$inferSelect;
export type CatalogoCategoria = typeof catalogoCategorias.$inferSelect;
export type GestorWhatsapp  = typeof gestorWhatsapp.$inferSelect;
export type LinkOferta        = typeof linksOferta.$inferSelect;
export type SolicitacaoOferta = typeof solicitacoesOferta.$inferSelect;
export type DisparoGrupo    = typeof disparosGrupo.$inferSelect;
export type GrupoCache      = typeof gruposCache.$inferSelect;
export type HorarioDisparo  = typeof horariosDisparo.$inferSelect;
export type DisparoGrupoLog = typeof disparosGrupoLog.$inferSelect;
