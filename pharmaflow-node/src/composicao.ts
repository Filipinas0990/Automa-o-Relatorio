/**
 * Raiz de composição: o único lugar que cria as classes e liga uma à outra.
 *
 * Cada classe recebe o que usa pelo construtor e não sabe de onde veio.
 * Para trocar uma peça (ex.: um repository falso num teste), troca-se aqui.
 */
import './env';
import { db } from './database/db';
import { HashSenha } from './compartilhado/HashSenha';
import { TokenSessao, lerSegredoJwt } from './auth/TokenSessao';
import { TransporteSessao } from './auth/TransporteSessao';
import { LimitadorLogin } from './auth/LimitadorLogin';
import { StateOAuth } from './auth/StateOAuth';
import { Autenticador } from './auth/Autenticador';
import { AuthService } from './auth/AuthService';
import { AuthController } from './auth/AuthController';
import { GestorRepository } from './gestores/GestorRepository';
import { GestorService } from './gestores/GestorService';
import { GestorController } from './gestores/GestorController';
import { encrypt } from './cripto';
import { FarmaciaRepository } from './farmacias/FarmaciaRepository';
import { DesempenhoRepository } from './farmacias/DesempenhoRepository';
import { FarmaciaService } from './farmacias/FarmaciaService';
import { DesempenhoService } from './farmacias/DesempenhoService';
import { FarmaciaController } from './farmacias/FarmaciaController';
import { PainelController } from './farmacias/PainelController';
import { RankingRepository } from './ranking/RankingRepository';
import { RankingService } from './ranking/RankingService';
import { RankingController } from './ranking/RankingController';
import { ReuniaoRepository } from './reunioes/ReuniaoRepository';
import { ClienteGoogleOAuth } from './google/ClienteGoogleOAuth';
import { AgendaGoogle } from './google/AgendaGoogle';
import { GoogleController } from './google/GoogleController';
import { ClienteGraphMeta } from './meta/ClienteGraphMeta';
import { ConexaoMetaService } from './meta/ConexaoMetaService';
import { ConexaoMetaController } from './meta/ConexaoMetaController';
import { BloqueioRepository } from './agenda/BloqueioRepository';
import { VerificadorConflito } from './agenda/VerificadorConflito';
import { AgendaService } from './agenda/AgendaService';
import { AgendaController } from './agenda/AgendaController';
import { CoberturaRepository } from './reunioes/CoberturaRepository';
import { CoberturaService } from './reunioes/CoberturaService';
import { ReuniaoService } from './reunioes/ReuniaoService';
import { ReuniaoController } from './reunioes/ReuniaoController';
import { DashboardRepository } from './dashboard/DashboardRepository';
import { DashboardService } from './dashboard/DashboardService';
import { DashboardController } from './dashboard/DashboardController';
import { WhatsappRepository } from './whatsapp/WhatsappRepository';
import { ClienteEvolution } from './whatsapp/ClienteEvolution';
import { WhatsappService } from './whatsapp/WhatsappService';
import { WhatsappController } from './whatsapp/WhatsappController';
import { CampanhaService } from './campanhas/CampanhaService';
import { PublicacaoAssincrona } from './campanhas/PublicacaoAssincrona';
import { CampanhaController } from './campanhas/CampanhaController';
import { ProdutoRepository } from './catalogo/ProdutoRepository';
import { CategoriaRepository } from './catalogo/CategoriaRepository';
import { CatalogoService } from './catalogo/CatalogoService';
import { CatalogoController } from './catalogo/CatalogoController';
import { SenhaBancoImagens } from './catalogo/SenhaBancoImagens';
import { DisparoRepository } from './disparos/DisparoRepository';
import { ClienteCampanhas } from './disparos/ClienteCampanhas';
import { DisparoService } from './disparos/DisparoService';
import { DisparoController } from './disparos/DisparoController';
import { InterpretadorIA } from './ai/InterpretadorIA';
import { TokenMetaRepository } from './ads/TokenMetaRepository';
import { CampanhaPendenteRepository } from './ads/CampanhaPendenteRepository';
import { ContaAnuncioCacheRepository } from './ads/ContaAnuncioCacheRepository';
import { GeocodificadorCidade } from './ads/GeocodificadorCidade';
import { AdsService } from './ads/AdsService';
import { AdsController } from './ads/AdsController';
import { CustoResultadoRepository } from './custo/CustoResultadoRepository';
import { CustoResultadoService } from './custo/CustoResultadoService';
import { CustoResultadoController } from './custo/CustoResultadoController';
import { ColetaRepository } from './coleta/ColetaRepository';
import { ImportacaoColetaService } from './coleta/ImportacaoColetaService';
import { ColetaDiariaRepository } from './coleta/ColetaDiariaRepository';
import { ImportacaoDiariaService } from './coleta/ImportacaoDiariaService';
import { LinkOfertaRepository } from './ofertas/LinkOfertaRepository';
import { SolicitacaoRepository } from './ofertas/SolicitacaoRepository';
import { LinkOfertaService } from './ofertas/LinkOfertaService';
import { SolicitacaoService } from './ofertas/SolicitacaoService';
import { CarteiraService } from './ofertas/CarteiraService';
import { OfertaPublicaController } from './ofertas/OfertaPublicaController';
import { OfertaController } from './ofertas/OfertaController';
import { ProdutoClienteRepository } from './ofertas/ProdutoClienteRepository';
import { ProdutoClienteService } from './ofertas/ProdutoClienteService';

const segredoJwt  = lerSegredoJwt();
const hashSenha   = new HashSenha();
/** Para onde os callbacks de OAuth devolvem o navegador. */
const frontendUrl = process.env.FRONTEND_URL || 'https://pharmarelatorios.online';

// ── Sessão ────────────────────────────────────────────────────────────────────
export const tokenSessao      = new TokenSessao(segredoJwt);
export const transporteSessao = new TransporteSessao();
export const stateGoogle      = new StateOAuth(segredoJwt, 'google-oauth');
export const stateMeta        = new StateOAuth(segredoJwt, 'meta-oauth');

// ── Gestores ──────────────────────────────────────────────────────────────────
export const gestorRepository = new GestorRepository(db);
export const autenticador     = new Autenticador(tokenSessao, transporteSessao, gestorRepository);
export const gestorController = new GestorController(new GestorService(gestorRepository, hashSenha), autenticador);

// ── Auth ──────────────────────────────────────────────────────────────────────
const authService = new AuthService(gestorRepository, hashSenha, new LimitadorLogin());
export const authController = new AuthController(authService, autenticador, tokenSessao, transporteSessao);

// ── WhatsApp (Evolution API) ──────────────────────────────────────────────────
export const whatsappRepository = new WhatsappRepository(db);
export const clienteEvolution   = new ClienteEvolution();
// O roteador de mensagens entrantes (bot de ads) é ligado mais abaixo, depois
// que AdsService existe — ver `whatsappService.definirRoteador(...)`.
export const whatsappService    = new WhatsappService(whatsappRepository, clienteEvolution);
export const whatsappController = new WhatsappController(whatsappService, autenticador);

// ── Disparo em grupos de WhatsApp ──────────────────────────────────────────────
// (repository + cliente do motor de campanhas já saem daqui; o Service entra
// mais abaixo, depois do solicitacaoRepository, que ele também usa)
export const disparoRepository = new DisparoRepository(db);
const clienteCampanhas = new ClienteCampanhas();

// ── Farmácias ─────────────────────────────────────────────────────────────────
const farmaciaRepository = new FarmaciaRepository(db);
const desempenhoService  = new DesempenhoService(new DesempenhoRepository(db), farmaciaRepository);
export const farmaciaController = new FarmaciaController(
  new FarmaciaService(farmaciaRepository), desempenhoService, autenticador,
);
export const painelController = new PainelController(desempenhoService, autenticador);

// ── Ads (bot de criação de campanhas via WhatsApp/Web + config Meta por cliente) ─
const tokenMetaRepository = new TokenMetaRepository(db);
export const adsService = new AdsService(
  tokenMetaRepository,
  new CampanhaPendenteRepository(db),
  new ContaAnuncioCacheRepository(db),
  farmaciaRepository,
  gestorRepository,
  new InterpretadorIA(),
  // WhatsappService satisfaz EnviadorWhatsapp (só precisa de enviarMensagem) por estrutura.
  whatsappService,
);
// Fecha o laço: a mensagem que chega pelo webhook do WhatsApp é roteada para o
// bot de ads. Só dá para ligar aqui, depois que os dois lados já existem — ver
// o comentário em WhatsappService.definirRoteador.
whatsappService.definirRoteador(adsService);
export const adsController = new AdsController(
  adsService, tokenMetaRepository, new GeocodificadorCidade(), autenticador,
);

// ── Custo por resultado do Meta (job das 06:00 + rota de leitura) ─────────────
export const custoResultadoService = new CustoResultadoService(new CustoResultadoRepository(db));
export const custoResultadoController = new CustoResultadoController(custoResultadoService, autenticador);

// ── Coleta do PharmaChatbot (importa o arquivo agregado do engine-prod) ───────
const coletaRepository = new ColetaRepository(db);
export const importacaoColetaService = new ImportacaoColetaService(coletaRepository, coletaRepository);
export const importacaoDiariaService = new ImportacaoDiariaService(
  coletaRepository, new ColetaDiariaRepository(db), importacaoColetaService,
);

// ── Ranking ───────────────────────────────────────────────────────────────────
export const rankingController = new RankingController(
  new RankingService(new RankingRepository(db), gestorRepository), autenticador,
);

// ── Google Calendar ───────────────────────────────────────────────────────────
const clienteGoogle = new ClienteGoogleOAuth({
  clientId:     process.env.GOOGLE_CLIENT_ID     || '',
  clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  redirectUri:  process.env.GOOGLE_REDIRECT_URI  || 'https://api.pharmarelatorios.online/api/auth/google/callback',
});
const reuniaoRepository = new ReuniaoRepository(db);
export const agendaGoogle = new AgendaGoogle(clienteGoogle, gestorRepository, reuniaoRepository);
export const googleController = new GoogleController(
  clienteGoogle, stateGoogle, gestorRepository, autenticador, frontendUrl,
);

// ── Facebook (Meta Ads) do gestor ─────────────────────────────────────────────
const conexaoMeta = new ConexaoMetaService(
  {
    appId:       process.env.META_APP_ID ?? '',
    appSecret:   process.env.META_APP_SECRET ?? '',
    redirectUri: process.env.META_REDIRECT_URI ?? 'https://api.pharmarelatorios.online/api/auth/meta/callback',
  },
  new ClienteGraphMeta(), stateMeta, gestorRepository, encrypt,
);
export const conexaoMetaController = new ConexaoMetaController(conexaoMeta, autenticador, frontendUrl);

// ── Agenda e reuniões ─────────────────────────────────────────────────────────
const bloqueioRepository  = new BloqueioRepository(db);
const verificadorConflito = new VerificadorConflito(bloqueioRepository, reuniaoRepository);
export const agendaController = new AgendaController(
  new AgendaService(bloqueioRepository, reuniaoRepository, verificadorConflito), autenticador,
);
export const reuniaoController = new ReuniaoController(
  new ReuniaoService(reuniaoRepository, farmaciaRepository, verificadorConflito, agendaGoogle),
  new CoberturaService(new CoberturaRepository(db)),
  autenticador,
);

// ── Dashboard ─────────────────────────────────────────────────────────────────
export const dashboardController = new DashboardController(
  new DashboardService(new DashboardRepository(db)), autenticador,
);

// ── Campanhas (Meta Ads) ──────────────────────────────────────────────────────
export const campanhaController = new CampanhaController(
  new CampanhaService(), new PublicacaoAssincrona(), autenticador,
);

// ── Catálogo de produtos (imagens dos criativos) ──────────────────────────────
const produtoRepository = new ProdutoRepository(db);
export const catalogoController = new CatalogoController(
  new CatalogoService(produtoRepository, new CategoriaRepository(db)),
  autenticador,
  // Senha única, definida no .env do servidor (gerar com `npm run senha-banco`).
  // 5 erros em 15 min travam as ações do banco para aquele admin.
  new SenhaBancoImagens(process.env.BANCO_IMAGENS_SENHA_HASH, new LimitadorLogin()),
);

// ── Ofertas (link público do dono da farmácia) ────────────────────────────────
// ProdutoRepository satisfaz ProdutosDoCatalogo & ImagensDoCatalogo (ver
// ofertas/SolicitacaoService e OfertaPublicaController) por estrutura — não
// precisa de objeto adaptador.
const catalogo = produtoRepository;
export const solicitacaoRepository = new SolicitacaoRepository(db);
const linkOfertaService = new LinkOfertaService(
  new LinkOfertaRepository(db), farmaciaRepository,
  // OFERTAS_URL_BASE existe para testar local sem mexer no FRONTEND_URL, que
  // também vale para os links de produção. Em produção, basta não definir.
  process.env.OFERTAS_URL_BASE || process.env.FRONTEND_URL || 'http://localhost:5173',
);
// Espaço de até 30 produtos (foto + nome) que cada cliente manda pelo link.
const produtoClienteRepository = new ProdutoClienteRepository(db);
const solicitacaoService = new SolicitacaoService(
  solicitacaoRepository, farmaciaRepository, catalogo, produtoClienteRepository,
);
const produtoClienteService = new ProdutoClienteService(
  produtoClienteRepository, farmaciaRepository, produtoClienteRepository,
);
export const ofertaPublicaController = new OfertaPublicaController(
  linkOfertaService, solicitacaoService, farmaciaRepository, catalogo, produtoClienteService,
);
export const ofertaController = new OfertaController(
  linkOfertaService, solicitacaoService,
  // DisparoRepository satisfaz CampanhasDosClientes (ver CarteiraService) por
  // estrutura — mesmo truque do ProdutoRepository acima, sem adaptador.
  new CarteiraService(farmaciaRepository, solicitacaoRepository, linkOfertaService, disparoRepository),
  autenticador,
  produtoClienteService,
);

// ── Disparo em grupos de WhatsApp (continuação) ───────────────────────────────
export const disparoService = new DisparoService(
  disparoRepository, whatsappRepository, clienteEvolution, clienteCampanhas, solicitacaoRepository,
);
export const disparoController = new DisparoController(disparoService, autenticador);
