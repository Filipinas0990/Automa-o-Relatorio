import {
  pgTable, pgView,
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
  googleRefreshToken:   text('google_refresh_token'),
  googleCalendarId:     varchar('google_calendar_id', { length: 255 }).default('primary'),
});

export const farmacias = pgTable('farmacias', {
  id:          serial('id').primaryKey(),
  nome:        varchar('nome', { length: 120 }).notNull(),
  urlBase:     varchar('url_base', { length: 255 }),
  email:       varchar('email', { length: 120 }),
  senhaEnc:    text('senha_enc'),
  gestorId:    integer('gestor_id').references(() => gestoresTrafego.id),
  ativa:       boolean('ativa').default(true),
  temChatbot:  boolean('tem_chatbot').default(true).notNull(),
  // 'entrada' = cliente novo sem credenciais; 'ativo' = cliente com acesso configurado
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

  googleEventId:  varchar('google_event_id', { length: 255 }),
  observacoes:    text('observacoes'),

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

// ── Tipos inferidos do schema (usados pela API e pipeline) ────────────────────

export type Gestor         = typeof gestoresTrafego.$inferSelect;
export type Farmacia       = typeof farmacias.$inferSelect;
export type Coleta         = typeof coletas.$inferSelect;
export type Reuniao        = typeof reunioes.$inferSelect;
export type AgendaBloqueio = typeof agendaBloqueios.$inferSelect;
export type Acao           = typeof acoes.$inferSelect;
export type FarmaciaAcao   = typeof farmaciaAcoes.$inferSelect;
