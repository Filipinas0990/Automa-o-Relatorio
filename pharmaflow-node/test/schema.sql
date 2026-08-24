--
-- PostgreSQL database dump
--

\restrict W41zhTntdXrtZcACcLoVfWhyn4p2aH59kPwGqluaCtZWE2kMZwYCYiYcfGeT06T

-- Dumped from database version 16.14
-- Dumped by pg_dump version 16.14

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: acoes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acoes (
    id integer NOT NULL,
    nome character varying(200) NOT NULL,
    tipo character varying(80) NOT NULL,
    descricao text,
    mes_referencia character varying(7) NOT NULL,
    status character varying(20) DEFAULT 'planejada'::character varying NOT NULL,
    cor character varying(7),
    criado_por_id integer,
    criado_em timestamp with time zone DEFAULT now(),
    atualizado_em timestamp with time zone DEFAULT now()
);


--
-- Name: acoes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.acoes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: acoes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.acoes_id_seq OWNED BY public.acoes.id;


--
-- Name: agenda_bloqueios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agenda_bloqueios (
    id integer NOT NULL,
    data date NOT NULL,
    hora_inicio character varying(5),
    hora_fim character varying(5),
    dia_inteiro boolean DEFAULT false NOT NULL,
    motivo character varying(200),
    criado_por_id integer,
    criado_em timestamp with time zone DEFAULT now()
);


--
-- Name: agenda_bloqueios_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.agenda_bloqueios_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: agenda_bloqueios_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.agenda_bloqueios_id_seq OWNED BY public.agenda_bloqueios.id;


--
-- Name: catalogo_produtos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.catalogo_produtos (
    id integer NOT NULL,
    nome character varying(200) NOT NULL,
    nome_norm character varying(200) NOT NULL,
    imagem_b64 text,
    mime character varying(40) DEFAULT 'image/png'::character varying,
    ativo boolean DEFAULT true NOT NULL,
    categoria character varying(40),
    criado_em timestamp with time zone DEFAULT now(),
    atualizado_em timestamp with time zone DEFAULT now()
);


--
-- Name: catalogo_produtos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.catalogo_produtos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: catalogo_produtos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.catalogo_produtos_id_seq OWNED BY public.catalogo_produtos.id;


--
-- Name: coleta_canais; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coleta_canais (
    id integer NOT NULL,
    coleta_id integer NOT NULL,
    canal character varying(80) NOT NULL,
    atendimentos integer DEFAULT 0,
    vendas integer DEFAULT 0,
    receita_vendas numeric(12,2) DEFAULT 0
);


--
-- Name: coleta_canais_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.coleta_canais_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: coleta_canais_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.coleta_canais_id_seq OWNED BY public.coleta_canais.id;


--
-- Name: coletas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coletas (
    id integer NOT NULL,
    farmacia_id integer NOT NULL,
    data_coleta timestamp with time zone DEFAULT now(),
    periodo_inicio date NOT NULL,
    periodo_fim date NOT NULL,
    periodo_dias integer DEFAULT 7,
    clientes_google integer DEFAULT 0,
    clientes_facebook integer DEFAULT 0,
    clientes_grupos_oferta integer DEFAULT 0,
    total_atendimentos integer DEFAULT 0,
    vendas_realizadas integer DEFAULT 0,
    receita_total numeric(12,2) DEFAULT 0,
    variacao_google numeric(8,2) DEFAULT 0,
    variacao_facebook numeric(8,2) DEFAULT 0,
    variacao_grupos numeric(8,2) DEFAULT 0,
    variacao_vendas numeric(8,2) DEFAULT 0,
    variacao_receita numeric(8,2) DEFAULT 0,
    score_criticidade numeric(5,2) DEFAULT 0,
    nivel_alerta character varying(10) DEFAULT 'verde'::character varying NOT NULL,
    atingiu_meta boolean DEFAULT false NOT NULL,
    atingiu_meta_google boolean,
    atingiu_meta_meta boolean,
    CONSTRAINT coletas_nivel_alerta_check CHECK (((nivel_alerta)::text = ANY ((ARRAY['verde'::character varying, 'amarelo'::character varying, 'vermelho'::character varying])::text[])))
);


--
-- Name: coletas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.coletas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: coletas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.coletas_id_seq OWNED BY public.coletas.id;


--
-- Name: disparos_grupo; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.disparos_grupo (
    id integer NOT NULL,
    gestor_id integer NOT NULL,
    titulo character varying(200) NOT NULL,
    mensagem text NOT NULL,
    grupos_json text NOT NULL,
    quando character varying(10) DEFAULT 'agora'::character varying NOT NULL,
    agendado_para timestamp with time zone,
    repetir character varying(10) DEFAULT 'nunca'::character varying NOT NULL,
    timezone character varying(50) DEFAULT 'America/Sao_Paulo'::character varying NOT NULL,
    status character varying(20) DEFAULT 'agendado'::character varying NOT NULL,
    proximo_envio timestamp with time zone,
    ultimo_envio timestamp with time zone,
    criado_em timestamp with time zone DEFAULT now(),
    atualizado_em timestamp with time zone DEFAULT now(),
    midias_json text,
    produtos_json text,
    farmacia_id integer,
    solicitacao_id integer
);


--
-- Name: disparos_grupo_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.disparos_grupo_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: disparos_grupo_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.disparos_grupo_id_seq OWNED BY public.disparos_grupo.id;


--
-- Name: disparos_grupo_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.disparos_grupo_log (
    id integer NOT NULL,
    disparo_id integer NOT NULL,
    grupo_jid character varying(120) NOT NULL,
    grupo_nome character varying(200),
    status character varying(10) NOT NULL,
    erro text,
    enviado_em timestamp with time zone DEFAULT now()
);


--
-- Name: disparos_grupo_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.disparos_grupo_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: disparos_grupo_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.disparos_grupo_log_id_seq OWNED BY public.disparos_grupo_log.id;


--
-- Name: farmacia_acoes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.farmacia_acoes (
    id integer NOT NULL,
    acao_id integer NOT NULL,
    farmacia_id integer NOT NULL,
    observacoes text,
    adicionado_em timestamp with time zone DEFAULT now(),
    adicionado_por_id integer
);


--
-- Name: farmacia_acoes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.farmacia_acoes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: farmacia_acoes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.farmacia_acoes_id_seq OWNED BY public.farmacia_acoes.id;


--
-- Name: farmacias; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.farmacias (
    id integer NOT NULL,
    nome character varying(120) NOT NULL,
    url_base character varying(255),
    email character varying(120),
    senha_enc text,
    gestor_id integer,
    ativa boolean DEFAULT true,
    criado_em timestamp with time zone DEFAULT now(),
    meta_vendas integer,
    meta_receita numeric(12,2),
    meta_leads_google integer,
    meta_leads_meta integer,
    tem_chatbot boolean DEFAULT true NOT NULL,
    fase character varying(10) DEFAULT 'ativo'::character varying NOT NULL,
    telefone character varying(20),
    responsavel character varying(120),
    cidade character varying(100),
    observacoes text
);


--
-- Name: farmacias_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.farmacias_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: farmacias_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.farmacias_id_seq OWNED BY public.farmacias.id;


--
-- Name: gestor_whatsapp; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gestor_whatsapp (
    id integer NOT NULL,
    gestor_id integer NOT NULL,
    instance_name character varying(100) NOT NULL,
    status character varying(20) DEFAULT 'close'::character varying NOT NULL,
    numero_conectado character varying(30),
    qr_code text,
    criado_em timestamp with time zone DEFAULT now(),
    atualizado_em timestamp with time zone DEFAULT now()
);


--
-- Name: gestor_whatsapp_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.gestor_whatsapp_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: gestor_whatsapp_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.gestor_whatsapp_id_seq OWNED BY public.gestor_whatsapp.id;


--
-- Name: gestores_trafego; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gestores_trafego (
    id integer NOT NULL,
    nome character varying(120) NOT NULL,
    email character varying(120) NOT NULL,
    senha_hash character varying(255) NOT NULL,
    is_admin boolean DEFAULT false NOT NULL,
    ativo boolean DEFAULT true,
    criado_em timestamp with time zone DEFAULT now(),
    google_refresh_token text,
    google_calendar_id character varying(255) DEFAULT 'primary'::character varying,
    telefone_whatsapp character varying(20)
);


--
-- Name: gestores_trafego_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.gestores_trafego_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: gestores_trafego_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.gestores_trafego_id_seq OWNED BY public.gestores_trafego.id;


--
-- Name: links_oferta; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.links_oferta (
    id integer NOT NULL,
    gestor_id integer NOT NULL,
    token character varying(64) NOT NULL,
    ativo boolean DEFAULT true NOT NULL,
    criado_em timestamp with time zone DEFAULT now(),
    atualizado_em timestamp with time zone DEFAULT now()
);


--
-- Name: links_oferta_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.links_oferta_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: links_oferta_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.links_oferta_id_seq OWNED BY public.links_oferta.id;


--
-- Name: reunioes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reunioes (
    id integer NOT NULL,
    farmacia_id integer NOT NULL,
    gestor_id integer,
    criado_por_id integer,
    titulo character varying(200) NOT NULL,
    descricao text,
    data_reuniao timestamp with time zone NOT NULL,
    duracao_minutos integer DEFAULT 60,
    local character varying(300),
    link_meet character varying(500),
    status character varying(20) DEFAULT 'agendada'::character varying NOT NULL,
    telefone character varying(20),
    google_event_id character varying(255),
    observacoes text,
    whatsapp_notificado_em timestamp with time zone,
    criado_em timestamp with time zone DEFAULT now(),
    atualizado_em timestamp with time zone DEFAULT now()
);


--
-- Name: reunioes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.reunioes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: reunioes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.reunioes_id_seq OWNED BY public.reunioes.id;


--
-- Name: solicitacoes_oferta; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solicitacoes_oferta (
    id integer NOT NULL,
    gestor_id integer NOT NULL,
    farmacia_id integer NOT NULL,
    produtos_json text NOT NULL,
    produtos_livres text,
    observacao text,
    enviado_por character varying(120),
    status character varying(20) DEFAULT 'pendente'::character varying NOT NULL,
    criado_em timestamp with time zone DEFAULT now(),
    atendida_em timestamp with time zone
);


--
-- Name: solicitacoes_oferta_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.solicitacoes_oferta_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: solicitacoes_oferta_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.solicitacoes_oferta_id_seq OWNED BY public.solicitacoes_oferta.id;


--
-- Name: vw_evolucao_semanal; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.vw_evolucao_semanal AS
 SELECT f.id AS farmacia_id,
    f.nome AS farmacia,
    c.periodo_inicio,
    c.periodo_fim,
    c.periodo_dias,
    c.clientes_google,
    c.clientes_facebook,
    c.clientes_grupos_oferta,
    c.vendas_realizadas,
    c.receita_total,
    c.score_criticidade,
    c.nivel_alerta,
    row_number() OVER (PARTITION BY f.id, c.periodo_dias ORDER BY c.data_coleta DESC) AS semana_numero
   FROM (public.farmacias f
     JOIN public.coletas c ON ((c.farmacia_id = f.id)))
  WHERE ((f.ativa = true) AND (c.data_coleta >= (now() - '56 days'::interval)));


--
-- Name: vw_ranking_atual; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.vw_ranking_atual AS
 WITH latest AS (
         SELECT DISTINCT ON (coletas.farmacia_id, coletas.periodo_dias) coletas.id,
            coletas.farmacia_id,
            coletas.periodo_dias,
            coletas.data_coleta,
            coletas.periodo_inicio,
            coletas.periodo_fim,
            coletas.clientes_google,
            coletas.clientes_facebook,
            coletas.clientes_grupos_oferta,
            coletas.total_atendimentos,
            coletas.vendas_realizadas,
            coletas.receita_total,
            coletas.variacao_google,
            coletas.variacao_facebook,
            coletas.variacao_grupos,
            coletas.variacao_vendas,
            coletas.variacao_receita,
            coletas.score_criticidade,
            coletas.nivel_alerta
           FROM public.coletas
          ORDER BY coletas.farmacia_id, coletas.periodo_dias, coletas.data_coleta DESC
        )
 SELECT f.id AS farmacia_id,
    f.nome AS farmacia,
    l.data_coleta,
    l.periodo_inicio,
    l.periodo_fim,
    l.periodo_dias,
    l.clientes_google,
    l.clientes_facebook,
    l.clientes_grupos_oferta,
    l.total_atendimentos,
    l.vendas_realizadas,
    l.receita_total,
    l.variacao_google,
    l.variacao_facebook,
    l.variacao_grupos,
    l.variacao_vendas,
    l.variacao_receita,
    l.score_criticidade,
    l.nivel_alerta,
    rank() OVER (PARTITION BY l.periodo_dias ORDER BY l.score_criticidade DESC) AS posicao_ranking
   FROM (public.farmacias f
     JOIN latest l ON ((l.farmacia_id = f.id)))
  WHERE (f.ativa = true);


--
-- Name: whatsapp_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.whatsapp_config (
    id integer NOT NULL,
    instance_name character varying(100) NOT NULL,
    status character varying(20) DEFAULT 'close'::character varying NOT NULL,
    qr_code text,
    numero_conectado character varying(30),
    atualizado_em timestamp with time zone DEFAULT now()
);


--
-- Name: whatsapp_config_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.whatsapp_config_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: whatsapp_config_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.whatsapp_config_id_seq OWNED BY public.whatsapp_config.id;


--
-- Name: acoes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acoes ALTER COLUMN id SET DEFAULT nextval('public.acoes_id_seq'::regclass);


--
-- Name: agenda_bloqueios id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agenda_bloqueios ALTER COLUMN id SET DEFAULT nextval('public.agenda_bloqueios_id_seq'::regclass);


--
-- Name: catalogo_produtos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalogo_produtos ALTER COLUMN id SET DEFAULT nextval('public.catalogo_produtos_id_seq'::regclass);


--
-- Name: coleta_canais id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coleta_canais ALTER COLUMN id SET DEFAULT nextval('public.coleta_canais_id_seq'::regclass);


--
-- Name: coletas id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coletas ALTER COLUMN id SET DEFAULT nextval('public.coletas_id_seq'::regclass);


--
-- Name: disparos_grupo id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disparos_grupo ALTER COLUMN id SET DEFAULT nextval('public.disparos_grupo_id_seq'::regclass);


--
-- Name: disparos_grupo_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disparos_grupo_log ALTER COLUMN id SET DEFAULT nextval('public.disparos_grupo_log_id_seq'::regclass);


--
-- Name: farmacia_acoes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.farmacia_acoes ALTER COLUMN id SET DEFAULT nextval('public.farmacia_acoes_id_seq'::regclass);


--
-- Name: farmacias id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.farmacias ALTER COLUMN id SET DEFAULT nextval('public.farmacias_id_seq'::regclass);


--
-- Name: gestor_whatsapp id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gestor_whatsapp ALTER COLUMN id SET DEFAULT nextval('public.gestor_whatsapp_id_seq'::regclass);


--
-- Name: gestores_trafego id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gestores_trafego ALTER COLUMN id SET DEFAULT nextval('public.gestores_trafego_id_seq'::regclass);


--
-- Name: links_oferta id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.links_oferta ALTER COLUMN id SET DEFAULT nextval('public.links_oferta_id_seq'::regclass);


--
-- Name: reunioes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reunioes ALTER COLUMN id SET DEFAULT nextval('public.reunioes_id_seq'::regclass);


--
-- Name: solicitacoes_oferta id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitacoes_oferta ALTER COLUMN id SET DEFAULT nextval('public.solicitacoes_oferta_id_seq'::regclass);


--
-- Name: whatsapp_config id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_config ALTER COLUMN id SET DEFAULT nextval('public.whatsapp_config_id_seq'::regclass);


--
-- Name: acoes acoes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acoes
    ADD CONSTRAINT acoes_pkey PRIMARY KEY (id);


--
-- Name: agenda_bloqueios agenda_bloqueios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agenda_bloqueios
    ADD CONSTRAINT agenda_bloqueios_pkey PRIMARY KEY (id);


--
-- Name: catalogo_produtos catalogo_produtos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalogo_produtos
    ADD CONSTRAINT catalogo_produtos_pkey PRIMARY KEY (id);


--
-- Name: coleta_canais coleta_canais_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coleta_canais
    ADD CONSTRAINT coleta_canais_pkey PRIMARY KEY (id);


--
-- Name: coletas coletas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coletas
    ADD CONSTRAINT coletas_pkey PRIMARY KEY (id);


--
-- Name: disparos_grupo_log disparos_grupo_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disparos_grupo_log
    ADD CONSTRAINT disparos_grupo_log_pkey PRIMARY KEY (id);


--
-- Name: disparos_grupo disparos_grupo_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disparos_grupo
    ADD CONSTRAINT disparos_grupo_pkey PRIMARY KEY (id);


--
-- Name: farmacia_acoes farmacia_acoes_acao_id_farmacia_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.farmacia_acoes
    ADD CONSTRAINT farmacia_acoes_acao_id_farmacia_id_key UNIQUE (acao_id, farmacia_id);


--
-- Name: farmacia_acoes farmacia_acoes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.farmacia_acoes
    ADD CONSTRAINT farmacia_acoes_pkey PRIMARY KEY (id);


--
-- Name: farmacias farmacias_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.farmacias
    ADD CONSTRAINT farmacias_pkey PRIMARY KEY (id);


--
-- Name: gestor_whatsapp gestor_whatsapp_gestor_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gestor_whatsapp
    ADD CONSTRAINT gestor_whatsapp_gestor_id_key UNIQUE (gestor_id);


--
-- Name: gestor_whatsapp gestor_whatsapp_instance_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gestor_whatsapp
    ADD CONSTRAINT gestor_whatsapp_instance_name_key UNIQUE (instance_name);


--
-- Name: gestor_whatsapp gestor_whatsapp_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gestor_whatsapp
    ADD CONSTRAINT gestor_whatsapp_pkey PRIMARY KEY (id);


--
-- Name: gestores_trafego gestores_trafego_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gestores_trafego
    ADD CONSTRAINT gestores_trafego_email_key UNIQUE (email);


--
-- Name: gestores_trafego gestores_trafego_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gestores_trafego
    ADD CONSTRAINT gestores_trafego_pkey PRIMARY KEY (id);


--
-- Name: gestores_trafego gestores_trafego_telefone_whatsapp_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gestores_trafego
    ADD CONSTRAINT gestores_trafego_telefone_whatsapp_key UNIQUE (telefone_whatsapp);


--
-- Name: links_oferta links_oferta_gestor_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.links_oferta
    ADD CONSTRAINT links_oferta_gestor_id_key UNIQUE (gestor_id);


--
-- Name: links_oferta links_oferta_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.links_oferta
    ADD CONSTRAINT links_oferta_pkey PRIMARY KEY (id);


--
-- Name: links_oferta links_oferta_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.links_oferta
    ADD CONSTRAINT links_oferta_token_key UNIQUE (token);


--
-- Name: reunioes reunioes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reunioes
    ADD CONSTRAINT reunioes_pkey PRIMARY KEY (id);


--
-- Name: solicitacoes_oferta solicitacoes_oferta_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitacoes_oferta
    ADD CONSTRAINT solicitacoes_oferta_pkey PRIMARY KEY (id);


--
-- Name: whatsapp_config whatsapp_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_config
    ADD CONSTRAINT whatsapp_config_pkey PRIMARY KEY (id);


--
-- Name: idx_canais_coleta_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_canais_coleta_id ON public.coleta_canais USING btree (coleta_id);


--
-- Name: idx_catalogo_nome_norm; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_catalogo_nome_norm ON public.catalogo_produtos USING btree (nome_norm);


--
-- Name: idx_coletas_data_coleta; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coletas_data_coleta ON public.coletas USING btree (data_coleta DESC);


--
-- Name: idx_coletas_farmacia_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coletas_farmacia_id ON public.coletas USING btree (farmacia_id);


--
-- Name: idx_coletas_nivel_alerta; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coletas_nivel_alerta ON public.coletas USING btree (nivel_alerta);


--
-- Name: idx_coletas_periodo_dias; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coletas_periodo_dias ON public.coletas USING btree (periodo_dias);


--
-- Name: idx_coletas_score; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coletas_score ON public.coletas USING btree (score_criticidade DESC);


--
-- Name: idx_disparos_grupo_gestor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_disparos_grupo_gestor ON public.disparos_grupo USING btree (gestor_id);


--
-- Name: idx_disparos_grupo_log_disparo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_disparos_grupo_log_disparo ON public.disparos_grupo_log USING btree (disparo_id);


--
-- Name: idx_disparos_grupo_pendentes; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_disparos_grupo_pendentes ON public.disparos_grupo USING btree (status, proximo_envio);


--
-- Name: idx_solicitacoes_oferta_farmacia; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_solicitacoes_oferta_farmacia ON public.solicitacoes_oferta USING btree (farmacia_id);


--
-- Name: idx_solicitacoes_oferta_gestor_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_solicitacoes_oferta_gestor_status ON public.solicitacoes_oferta USING btree (gestor_id, status);


--
-- Name: acoes acoes_criado_por_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acoes
    ADD CONSTRAINT acoes_criado_por_id_fkey FOREIGN KEY (criado_por_id) REFERENCES public.gestores_trafego(id) ON DELETE SET NULL;


--
-- Name: agenda_bloqueios agenda_bloqueios_criado_por_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agenda_bloqueios
    ADD CONSTRAINT agenda_bloqueios_criado_por_id_fkey FOREIGN KEY (criado_por_id) REFERENCES public.gestores_trafego(id) ON DELETE SET NULL;


--
-- Name: coleta_canais coleta_canais_coleta_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coleta_canais
    ADD CONSTRAINT coleta_canais_coleta_id_fkey FOREIGN KEY (coleta_id) REFERENCES public.coletas(id) ON DELETE CASCADE;


--
-- Name: coletas coletas_farmacia_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coletas
    ADD CONSTRAINT coletas_farmacia_id_fkey FOREIGN KEY (farmacia_id) REFERENCES public.farmacias(id) ON DELETE CASCADE;


--
-- Name: disparos_grupo disparos_grupo_farmacia_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disparos_grupo
    ADD CONSTRAINT disparos_grupo_farmacia_id_fkey FOREIGN KEY (farmacia_id) REFERENCES public.farmacias(id);


--
-- Name: disparos_grupo disparos_grupo_gestor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disparos_grupo
    ADD CONSTRAINT disparos_grupo_gestor_id_fkey FOREIGN KEY (gestor_id) REFERENCES public.gestores_trafego(id);


--
-- Name: disparos_grupo_log disparos_grupo_log_disparo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disparos_grupo_log
    ADD CONSTRAINT disparos_grupo_log_disparo_id_fkey FOREIGN KEY (disparo_id) REFERENCES public.disparos_grupo(id);


--
-- Name: disparos_grupo disparos_grupo_solicitacao_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disparos_grupo
    ADD CONSTRAINT disparos_grupo_solicitacao_id_fkey FOREIGN KEY (solicitacao_id) REFERENCES public.solicitacoes_oferta(id);


--
-- Name: farmacia_acoes farmacia_acoes_acao_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.farmacia_acoes
    ADD CONSTRAINT farmacia_acoes_acao_id_fkey FOREIGN KEY (acao_id) REFERENCES public.acoes(id) ON DELETE CASCADE;


--
-- Name: farmacia_acoes farmacia_acoes_adicionado_por_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.farmacia_acoes
    ADD CONSTRAINT farmacia_acoes_adicionado_por_id_fkey FOREIGN KEY (adicionado_por_id) REFERENCES public.gestores_trafego(id) ON DELETE SET NULL;


--
-- Name: farmacia_acoes farmacia_acoes_farmacia_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.farmacia_acoes
    ADD CONSTRAINT farmacia_acoes_farmacia_id_fkey FOREIGN KEY (farmacia_id) REFERENCES public.farmacias(id) ON DELETE CASCADE;


--
-- Name: farmacias farmacias_gestor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.farmacias
    ADD CONSTRAINT farmacias_gestor_id_fkey FOREIGN KEY (gestor_id) REFERENCES public.gestores_trafego(id) ON DELETE SET NULL;


--
-- Name: gestor_whatsapp gestor_whatsapp_gestor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gestor_whatsapp
    ADD CONSTRAINT gestor_whatsapp_gestor_id_fkey FOREIGN KEY (gestor_id) REFERENCES public.gestores_trafego(id);


--
-- Name: links_oferta links_oferta_gestor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.links_oferta
    ADD CONSTRAINT links_oferta_gestor_id_fkey FOREIGN KEY (gestor_id) REFERENCES public.gestores_trafego(id);


--
-- Name: reunioes reunioes_criado_por_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reunioes
    ADD CONSTRAINT reunioes_criado_por_id_fkey FOREIGN KEY (criado_por_id) REFERENCES public.gestores_trafego(id) ON DELETE SET NULL;


--
-- Name: reunioes reunioes_farmacia_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reunioes
    ADD CONSTRAINT reunioes_farmacia_id_fkey FOREIGN KEY (farmacia_id) REFERENCES public.farmacias(id) ON DELETE CASCADE;


--
-- Name: reunioes reunioes_gestor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reunioes
    ADD CONSTRAINT reunioes_gestor_id_fkey FOREIGN KEY (gestor_id) REFERENCES public.gestores_trafego(id) ON DELETE SET NULL;


--
-- Name: solicitacoes_oferta solicitacoes_oferta_farmacia_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitacoes_oferta
    ADD CONSTRAINT solicitacoes_oferta_farmacia_id_fkey FOREIGN KEY (farmacia_id) REFERENCES public.farmacias(id);


--
-- Name: solicitacoes_oferta solicitacoes_oferta_gestor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitacoes_oferta
    ADD CONSTRAINT solicitacoes_oferta_gestor_id_fkey FOREIGN KEY (gestor_id) REFERENCES public.gestores_trafego(id);


--
-- PostgreSQL database dump complete
--

\unrestrict W41zhTntdXrtZcACcLoVfWhyn4p2aH59kPwGqluaCtZWE2kMZwYCYiYcfGeT06T

