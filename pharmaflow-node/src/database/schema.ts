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
  urlBase:     varchar('url_base', { length: 255 }).notNull(),
  email:       varchar('email', { length: 120 }).notNull(),
  senhaEnc:    text('senha_enc'),
  gestorId:    integer('gestor_id').references(() => gestoresTrafego.id),
  ativa:       boolean('ativa').default(true),
  criadoEm:    timestamp('criado_em', { withTimezone: true }).defaultNow(),
  metaVendas:       integer('meta_vendas'),
  metaReceita:      numeric('meta_receita',       { precision: 12, scale: 2 }),
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
  receitaTotal:         numeric('receita_total',    { precision: 12, scale: 2 }).default('0'),
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
  receitaVendas: numeric('receita_vendas', { precision: 12, scale: 2 }).default('0'),
});

// ── Views (existem no banco — só mapeamos para usar com sql``) ────────────────

export const vwRankingAtual = pgView('vw_ranking_atual', {
  farmaciaId:        integer('farmacia_id'),
  farmacia:          varchar('farmacia', { length: 120 }),
  nivelAlerta:       varchar('nivel_alerta', { length: 10 }),
  receitaTotal:      numeric('receita_total',      { precision: 12, scale: 2 }),
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
  receitaTotal:      numeric('receita_total',     { precision: 12, scale: 2 }),
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

// ── Tipos inferidos do schema (usados pela API e pipeline) ────────────────────

export type Gestor   = typeof gestoresTrafego.$inferSelect;
export type Farmacia = typeof farmacias.$inferSelect;
export type Coleta   = typeof coletas.$inferSelect;
export type Reuniao  = typeof reunioes.$inferSelect;
