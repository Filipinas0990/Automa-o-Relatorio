import '../env';
import Fastify from 'fastify';
import cors     from '@fastify/cors';
import formbody from '@fastify/formbody';
import { logger } from '../logger';
import { iniciarSchedulerWhatsApp } from '../scheduler';
import { whatsappRoutes } from '../whatsapp/routes';
import { adsRoutes } from '../ads/routes';
import { aquecerContasAnuncio } from '../ads/service';
import { catalogoRoutes } from '../catalogo/routes';
import { campanhasRoutes } from '../campanhas/routes';
import { disparosRoutes } from '../disparos/routes';
import {
  autenticador, authController, gestorController, farmaciaController, painelController,
  rankingController, googleController, conexaoMetaController,
  agendaController, reuniaoController, dashboardController, acaoController,
  ofertaPublicaController, ofertaController,
} from '../composicao';

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    transport: {
      targets: [
        {
          target: 'pino-pretty',
          level: process.env.LOG_LEVEL || 'info',
          options: { colorize: true, translateTime: 'yyyy-mm-dd HH:MM:ss', ignore: 'pid,hostname' },
        },
        {
          target: 'pino/file',
          level: 'info',
          options: { destination: process.env.LOG_FILE || './logs/pharmaflow.log', mkdir: true },
        },
      ],
    },
  },
});
app.register(cors,      { origin: '*' });
app.register(formbody);

// Aceita corpo vazio com Content-Type: application/json (ex: POST sem body)
app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
  if (!body || body === '') { done(null, {}); return; }
  try { done(null, JSON.parse(body as string)); }
  catch (e) { done(e as Error, undefined); }
});

// ── Controllers (classes montadas em ../composicao) ──────────────────────────
const { autenticar, apenasAdmin } = autenticador;

app.register(authController.plugin);
app.register(gestorController.plugin);
app.register(farmaciaController.plugin);
app.register(painelController.plugin);
app.register(rankingController.plugin);
app.register(googleController.plugin);
app.register(conexaoMetaController.plugin);
app.register(agendaController.plugin);
app.register(reuniaoController.plugin);
app.register(dashboardController.plugin);
app.register(acaoController.plugin);
// Ofertas: as rotas PÚBLICAS (/api/publico/ofertas/*) usam o token do link como credencial
app.register(ofertaPublicaController.plugin);
app.register(ofertaController.plugin);

// ── Módulos ainda em funções (plugins recebem os middlewares por opção) ───────
app.register(whatsappRoutes, { autenticar, apenasAdmin });
app.register(adsRoutes,      { autenticar, apenasAdmin });
app.register(catalogoRoutes, { autenticar, apenasAdmin });
app.register(campanhasRoutes,{ autenticar, apenasAdmin });
// Disparo em grupos: rotas usam só `autenticar` — cada gestor opera as farmácias dele
app.register(disparosRoutes, { autenticar, apenasAdmin });

// ── Tratamento global de erros ────────────────────────────────────────────────

app.setErrorHandler((error, _request, reply) => {
  logger.error({ err: error }, 'Erro interno não tratado');
  reply.code(500).send({ detail: 'Erro interno do servidor' });
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || '8000', 10);

// Só sobe a porta quando este arquivo é o ponto de entrada. Nos testes o app é
// importado e exercitado com `app.inject()`, sem abrir socket nem ligar o cron.
if (require.main === module) {
  app.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
    if (err) { console.error(err); process.exit(1); }
    console.log(`PharmaFlow API rodando em http://0.0.0.0:${PORT}`);
    iniciarSchedulerWhatsApp();
    // Aquece o cache das contas de anúncio (migration 0032): o primeiro gestor
    // a abrir o wizard de campanha depois do deploy encontra a lista pronta,
    // em vez de esperar a Meta responder. Falha aqui não derruba nada — a
    // listagem sincroniza sozinha na primeira visita.
    aquecerContasAnuncio();
  });
}

export { app };

export default app;
