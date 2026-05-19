import 'dotenv/config';
import { chromium } from 'playwright';
import type { Browser, Page, Locator } from 'playwright';
import type { DadosFarmacia, FarmaciaParaColeta } from '../types';

const DEBUG = (process.env.DEBUG_SCREENSHOTS || 'false').toLowerCase() === 'true';
const DEBUG_DIR = '/app/logs/debug_screenshots';

const BROWSER_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--no-zygote',
  '--single-process',           // tudo em 1 processo — reduz memória 60%
  '--disable-gpu',
  '--disable-blink-features=AutomationControlled',
  '--disable-infobars',
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-default-apps',
  '--disable-sync',
  '--disable-translate',
  '--hide-scrollbars',
  '--mute-audio',
  '--window-size=1366,768',
  '--js-flags=--max-old-space-size=512',
];

function parseMoeda(texto: string | number): number {
  const limpo = String(texto).replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.');
  const val = parseFloat(limpo);
  return isNaN(val) ? 0 : val;
}

function parseInteiro(texto: string | number): number {
  const limpo = String(texto).replace(/\D/g, '');
  return limpo ? parseInt(limpo, 10) : 0;
}

async function screenshot(page: Page, nome: string): Promise<void> {
  if (!DEBUG) return;
  try {
    const fs = await import('fs');
    fs.mkdirSync(DEBUG_DIR, { recursive: true });
    const ts = new Date().toTimeString().slice(0, 8).replace(/:/g, '');
    const path = `${DEBUG_DIR}/${ts}_${nome}.png`;
    await page.screenshot({ path, fullPage: true, timeout: 8000 });
    console.log(`  [DEBUG] screenshot: ${path}`);
  } catch (ex: unknown) {
    console.log(`  [DEBUG] screenshot falhou: ${(ex as Error).message}`);
  }
}

const EMAIL_SELETORES = [
  'input[type="email"]',
  'input[name="email"]',
  'input[name="username"]',
  'input[name="login"]',
  'input[type="text"]',
];

async function fazerLogin(page: Page, email: string, senha: string): Promise<boolean> {
  console.log(`  [LOGIN] iniciando | url: ${page.url()}`);

  // Espera o React renderizar o formulário de login (1 selector combinado, timeout longo)
  const SEL_EMAIL = 'input[type="email"], input[name="email"], input[name="username"], input[name="login"], input[type="text"]';
  try {
    await page.waitForSelector(SEL_EMAIL, { timeout: 25000 });
  } catch (e) {
    // Diagnóstico: lista inputs visíveis para depuração
    try {
      const inputs = await page.evaluate(() =>
        Array.from(document.querySelectorAll('input')).map(i =>
          `type=${i.type} name=${i.name} id=${i.id} ph=${i.placeholder}`
        )
      );
      console.log(`  [LOGIN] falha — sem campo email. URL: ${page.url()} | inputs: ${JSON.stringify(inputs)}`);
    } catch {
      console.log(`  [LOGIN] falha — página inacessível. URL: ${page.url()} | err: ${(e as Error).message}`);
    }
    return false;
  }

  const emailLocator: Locator = page.locator(SEL_EMAIL).first();
  console.log(`  [LOGIN] campo encontrado, preenchendo...`);

  await screenshot(page, '01_pre_login');
  await emailLocator.fill(email);
  await page.waitForTimeout(400);
  await page.locator('input[type="password"]').first().fill(senha);
  await page.waitForTimeout(600);

  await screenshot(page, '02_pre_submit');

  const botao = page.locator('button:has-text("Entrar"), button:has-text("Sign In"), button[type="submit"]');
  if (await botao.count() > 0) {
    await botao.first().click();
  } else {
    await page.keyboard.press('Enter');
  }

  await page.waitForTimeout(2000);

  const PALAVRAS_LOGIN = ['esqueci minha senha', 'escique minha senha', 'lembrar-me', 'forget my password', 'remember me', 'r/me'];

  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(1000);
    try {
      const corpo = (await page.locator('body').textContent({ timeout: 3000 })) || '';
      const t = corpo.toLowerCase();
      if (!PALAVRAS_LOGIN.some(p => t.includes(p))) {
        if (DEBUG) console.log(`  [DEBUG] login OK em ${i + 1}s, URL: ${page.url()}`);
        await screenshot(page, '03_dashboard');
        return true;
      }
    } catch { /* continua */ }
  }

  if (DEBUG) console.log(`  [DEBUG] login FALHOU. URL: ${page.url()}`);
  await screenshot(page, '03_login_falhou');
  return false;
}

async function aplicarFiltroDatas(page: Page, inicio: string, fim: string): Promise<void> {
  const filtrosBtn = page.locator(
    'button:has-text("Filtros"), span:has-text("Filtros"), button:has-text("Filters"), span:has-text("Filters")'
  );
  if (await filtrosBtn.count() > 0) {
    try { await filtrosBtn.first().click({ timeout: 8000 }); await page.waitForTimeout(800); }
    catch { /* não clicável — continua sem filtro */ }
  }

  let dateInputs = page.locator('input[type="date"]');
  if (await dateInputs.count() < 2) {
    dateInputs = page.locator('input[placeholder*="/"], input[placeholder*="-"], input[class*="date"]');
  }

  const dInicio = new Date(inicio + 'T00:00:00');
  const dFim    = new Date(fim    + 'T00:00:00');
  const brInicio = `${String(dInicio.getDate()).padStart(2,'0')}/${String(dInicio.getMonth()+1).padStart(2,'0')}/${dInicio.getFullYear()}`;
  const brFim    = `${String(dFim.getDate()).padStart(2,'0')}/${String(dFim.getMonth()+1).padStart(2,'0')}/${dFim.getFullYear()}`;

  if (await dateInputs.count() >= 2) {
    try {
      await dateInputs.nth(0).fill(inicio, { timeout: 5000 });
      await dateInputs.nth(1).fill(fim,    { timeout: 5000 });
    } catch {
      await dateInputs.nth(0).click({ clickCount: 3 });
      await dateInputs.nth(0).type(brInicio);
      await dateInputs.nth(1).click({ clickCount: 3 });
      await dateInputs.nth(1).type(brFim);
    }
  }

  const salvarBtn = page.locator('button:has-text("Salvar"), button:has-text("Save")');
  if (await salvarBtn.count() > 0 && await salvarBtn.first().isEnabled()) {
    await salvarBtn.first().click({ timeout: 8000 });
  }

  try { await page.waitForLoadState('networkidle', { timeout: 20000 }); }
  catch { await page.waitForTimeout(2000); }
  await page.waitForTimeout(1000);

  try {
    if (await page.locator('input[type="date"]').isVisible()) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(600);
    }
  } catch { /* ok */ }

  await screenshot(page, '04_apos_filtro');
}

async function extrairCanaisPizza(page: Page): Promise<Record<string, number>> {
  // Scroll até o gráfico de pizza
  await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('*')) as HTMLElement[];
    const el = els.find(e => (e.innerText || '').includes('canal de divulga'));
    if (el) el.scrollIntoView({ behavior: 'instant', block: 'center' });
  });
  await page.waitForTimeout(800);

  // Método 1: React fiber
  const canais = await page.evaluate((): Record<string, number> => {
    function getFiberKey(el: Element): string | undefined {
      return Object.keys(el).find(k =>
        k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance')
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function walkFiber(fiber: any, depth: number): [string, number][] {
      if (!fiber || depth > 30) return [];
      const out: [string, number][] = [];
      const props = fiber.memoizedProps || {};
      if (Array.isArray(props.data)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        props.data.forEach((d: any) => {
          const nome  = d.nome || d.name || d.label || '';
          const total = d.total || d.value || d.count || 0;
          if (nome && total > 0) out.push([String(nome), Number(total)]);
        });
      }
      if (fiber.child)   out.push(...walkFiber(fiber.child,   depth + 1));
      if (fiber.sibling) out.push(...walkFiber(fiber.sibling, depth + 1));
      return out;
    }
    const headings = Array.from(document.querySelectorAll('*')).filter(
      e => (e as HTMLElement).innerText?.trim().includes('canal de divulga') && e.children.length === 0
    ) as HTMLElement[];
    const resultados: Record<string, number> = {};
    for (const h of headings) {
      let container: Element | null = h.parentElement;
      for (let i = 0; i < 8; i++) {
        if (!container) break;
        const svg = container.querySelector('svg');
        if (svg) {
          const key = getFiberKey(svg);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (key) walkFiber((svg as any)[key], 0).forEach(([nome, total]) => { resultados[nome] = total; });
          svg.querySelectorAll('path').forEach(p => {
            const k = getFiberKey(p);
            if (!k) return;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            walkFiber((p as any)[k], 0).forEach(([nome, total]) => { resultados[nome] = total; });
          });
          break;
        }
        container = container.parentElement;
      }
    }
    return resultados;
  });

  if (canais && Object.values(canais).some(v => v > 0)) return canais;

  // Método 2: hover nas fatias
  const heading = page.locator('text=canal de divulga').first();
  if (await heading.count() === 0) return {};

  const container = heading.locator('xpath=ancestor::div[.//svg][1]');
  if (await container.count() === 0) return {};

  const fatias = container.locator("svg path[fill]:not([fill='none'])");
  const totalFatias = await fatias.count();
  const vistos = new Set<string>();
  const resultado: Record<string, number> = {};

  for (let i = 0; i < totalFatias; i++) {
    try {
      await fatias.nth(i).hover({ force: true, timeout: 3000 });
      await page.waitForTimeout(400);
      const tooltip = page.locator(
        '[class*="recharts-tooltip-wrapper"], [class*="tooltip"], [class*="Tooltip"]'
      ).filter({ hasText: /\d+/ });
      if (await tooltip.count() === 0) continue;
      const texto = ((await tooltip.first().textContent({ timeout: 2000 })) || '').trim();
      if (!texto || vistos.has(texto)) continue;
      vistos.add(texto);
      const nomeM  = texto.match(/nome[:\s]+(.+?)(?:\n|total|$)/i);
      const totalM = texto.match(/total[:\s]+([\d.,]+)/i);
      if (nomeM && totalM) {
        const nome  = nomeM[1].trim();
        const total = parseInteiro(totalM[1]);
        if (nome && total > 0) resultado[nome] = total;
      }
    } catch { continue; }
  }

  return resultado;
}

interface CanalBarraItem {
  label: string;
  total: number;
  price: number | string;
}

async function extrairCanaisBarrasFiber(page: Page): Promise<Record<string, { vendas: number; receita: number }>> {
  await page.evaluate(() => {
    const h = Array.from(document.querySelectorAll('*')).find(e =>
      e.children.length === 0 && (e as HTMLElement).innerText?.toLowerCase().includes('vendas por canal')
    ) as HTMLElement | undefined;
    if (h) h.scrollIntoView({ behavior: 'instant', block: 'center' });
  });
  await page.waitForTimeout(600);

  const raw = await page.evaluate((): CanalBarraItem[] | null => {
    function getFiberKey(el: Element): string | undefined {
      return Object.keys(el).find(k =>
        k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance')
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function walkFiber(fiber: any, depth: number): any[] | null {
      if (!fiber || depth > 50) return null;
      const props = fiber.memoizedProps || {};
      if (Array.isArray(props.data) && props.data.length > 0) {
        const s = props.data[0];
        if (typeof s.label === 'string' && s.label.length > 1 &&
            typeof s.total === 'number' && 'price' in s) {
          return props.data;
        }
      }
      if (Array.isArray(props.points)) {
        const s = props.points[0] || {};
        if (s.payload && 'label' in s.payload && 'price' in s.payload) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return props.points.map((p: any) => p.payload);
        }
      }
      const r1 = fiber.child   ? walkFiber(fiber.child,   depth + 1) : null;
      if (r1) return r1;
      return fiber.sibling ? walkFiber(fiber.sibling, depth + 1) : null;
    }

    const headings = Array.from(document.querySelectorAll('*')).filter(e =>
      e.children.length === 0 && (e as HTMLElement).innerText?.toLowerCase().includes('vendas por canal')
    );
    for (const h of headings) {
      let el: Element | null = h.parentElement;
      for (let i = 0; i < 15; i++) {
        if (!el) break;
        const svg = el.querySelector('svg');
        if (svg) {
          const key = getFiberKey(svg);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (key) { const d = walkFiber((svg as any)[key], 0); if (d) return d; }
          for (const rect of svg.querySelectorAll('rect')) {
            const k = getFiberKey(rect);
            if (!k) continue;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const d = walkFiber((rect as any)[k], 0);
            if (d) return d;
          }
          for (const child of el.querySelectorAll('*')) {
            const k = getFiberKey(child);
            if (!k) continue;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const d = walkFiber((child as any)[k], 0);
            if (d) return d;
          }
          break;
        }
        el = el.parentElement;
      }
    }
    for (const svg of document.querySelectorAll('svg')) {
      if (svg.querySelectorAll('rect').length < 2) continue;
      const key = getFiberKey(svg);
      if (!key) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = walkFiber((svg as any)[key], 0);
      if (d) return d;
    }
    return null;
  });

  if (!raw || !Array.isArray(raw)) {
    console.log('  [CANAL] fiber retornou vazio');
    return {};
  }

  const canais: Record<string, { vendas: number; receita: number }> = {};
  for (const item of raw) {
    if (typeof item !== 'object') continue;
    const nome    = String(item.label || '').trim();
    const vendas  = parseInt(String(item.total || 0), 10) || 0;
    const priceRaw = item.price || 0;
    const receita = typeof priceRaw === 'string' ? parseMoeda(priceRaw) : parseFloat(String(priceRaw || 0));
    if (nome) canais[nome] = { vendas, receita };
  }

  console.log('  [CANAL] fiber:', JSON.stringify(canais));
  return canais;
}

function buscarCanalReceitaEmJson(obj: unknown, depth = 0): Record<string, { vendas: number; receita: number }> {
  if (depth > 8 || !obj) return {};
  const resultado: Record<string, { vendas: number; receita: number }> = {};

  if (Array.isArray(obj) && obj.length >= 2 && typeof obj[0] === 'object' && obj[0] !== null) {
    const sample  = obj[0] as Record<string, unknown>;
    const keys    = Object.keys(sample);
    const strKeys = keys.filter(k => typeof sample[k] === 'string' && (sample[k] as string).length > 2);
    const numKeys = keys.filter(k => typeof sample[k] === 'number');
    if (strKeys.length && numKeys.length >= 2) {
      const nomeK = strKeys[0];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const recK  = numKeys.reduce((a, b) =>
        (obj as any[]).reduce((s: number, i: any) => s + (i[a] || 0), 0) >
        (obj as any[]).reduce((s: number, i: any) => s + (i[b] || 0), 0) ? a : b
      );
      const vendasK = numKeys.find(k => k !== recK);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const avgRec = (obj as any[]).reduce((s: number, i: any) => s + parseFloat(i[recK] || 0), 0) / obj.length;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const avgVnd = vendasK ? (obj as any[]).reduce((s: number, i: any) => s + parseFloat(i[vendasK] || 0), 0) / obj.length : 0;
      if (avgRec > avgVnd * 5) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const item of obj as any[]) {
          const nome    = String(item[nomeK] || '');
          const receita = parseFloat(item[recK] || 0);
          if (nome && receita > 0) {
            resultado[nome] = { vendas: vendasK ? parseInt(item[vendasK] || 0, 10) : 0, receita };
          }
        }
      }
    }
  }

  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const v of Object.values(obj as object)) Object.assign(resultado, buscarCanalReceitaEmJson(v, depth + 1));
  } else if (Array.isArray(obj)) {
    for (const item of obj) {
      if (typeof item === 'object') Object.assign(resultado, buscarCanalReceitaEmJson(item, depth + 1));
    }
  }
  return resultado;
}

async function extrairReceita(page: Page): Promise<number> {
  try {
    const corpo = await page.locator('body').textContent({ timeout: 5000 });
    const match = (corpo || '').match(/R\$\s*[\d.,]+/);
    if (match) return parseMoeda(match[0]);
  } catch { /* ok */ }
  return 0;
}

async function extrairVendasBadge(page: Page): Promise<number> {
  const badges = await page.evaluate((): { numero: number; label: string }[] => {
    const resultado: { numero: number; label: string }[] = [];
    document.querySelectorAll('*').forEach(el => {
      const txt = (el as HTMLElement).innerText || '';
      if (el.children.length === 0 && /^\d+$/.test(txt.trim()) && parseInt(txt) > 0) {
        const pai = el.parentElement;
        const labelEl = pai ? pai.querySelector('*:not(:first-child)') : null;
        const label = labelEl ? ((labelEl as HTMLElement).innerText || '').trim() : '';
        const avo = pai ? pai.parentElement : null;
        const labelAvo = avo ? ((avo as HTMLElement).innerText || '').trim() : '';
        resultado.push({ numero: parseInt(txt.trim()), label: label || labelAvo.replace(txt.trim(), '').trim() });
      }
    });
    return resultado;
  });
  for (const b of badges) {
    const label = (b.label || '').toLowerCase();
    if ((label.includes('venda') || label.includes('sale')) && !label.includes('não') && !label.includes('nao')) {
      return b.numero;
    }
  }
  return 0;
}

async function extrairTotalAtendimentos(page: Page): Promise<number> {
  const badges = await page.evaluate((): { numero: number; label: string }[] => {
    const resultado: { numero: number; label: string }[] = [];
    document.querySelectorAll('*').forEach(el => {
      const txt = (el as HTMLElement).innerText || '';
      if (el.children.length === 0 && /^\d+$/.test(txt.trim()) && parseInt(txt) > 10) {
        const pai = el.parentElement;
        const labelEl = pai ? pai.querySelector('*:not(:first-child)') : null;
        const label = labelEl ? ((labelEl as HTMLElement).innerText || '').trim() : '';
        const avo = pai ? pai.parentElement : null;
        const labelAvo = avo ? ((avo as HTMLElement).innerText || '').trim() : '';
        resultado.push({ numero: parseInt(txt.trim()), label: label || labelAvo.replace(txt.trim(), '').trim() });
      }
    });
    return resultado;
  });
  for (const b of badges) {
    const label = (b.label || '').toLowerCase();
    if (label.includes('total') && label.includes('atendimento')) return b.numero;
  }
  return 0;
}

function mapearCanais(canais: Record<string, number>): { google: number; facebook: number; gruposOferta: number } {
  let google = 0, facebook = 0, grupos = 0;
  for (const [nome, total] of Object.entries(canais)) {
    const n = nome.toLowerCase();
    if (n.includes('google'))                                                          google   += total;
    else if (n.includes('facebook') || n.includes('instagram') || n.includes('meta')) facebook += total;
    else if (n.includes('grupo') || n.includes('oferta') || n.includes('group'))      grupos   += total;
  }
  return { google, facebook, gruposOferta: grupos };
}

export async function coletarFarmacia(farmacia: FarmaciaParaColeta & { dias?: number }): Promise<DadosFarmacia> {
  const { nome, urlBase, email, senha, dias = 7 } = farmacia;
  const hoje  = new Date();
  const start = new Date(hoje.getTime() - dias * 86400000);
  const fmt   = (d: Date) => d.toISOString().slice(0, 10);
  const inicio = fmt(start);
  const fim    = fmt(hoje);

  const browser = await chromium.launch({ headless: true, args: BROWSER_ARGS });
  try {
    return await _coletarComBrowser(browser, nome, urlBase, email, senha, inicio, fim);
  } finally {
    await browser.close();
  }
}

async function _coletarComBrowser(
  browser: Browser,
  nome: string,
  urlBase: string,
  email: string,
  senha: string,
  inicio: string,
  fim: string,
): Promise<DadosFarmacia> {
  const errResult = (erro: string): DadosFarmacia => ({
    nome, periodoInicio: inicio, periodoFim: fim,
    clientesGoogle: 0, clientesFacebook: 0, clientesGruposOferta: 0,
    totalAtendimentos: 0, vendasRealizadas: 0, receitaTotal: 0,
    canais: {}, canaisVendas: {}, erro,
  });

  const context = await browser.newContext({
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    viewport: { width: 1366, height: 768 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    extraHTTPHeaders: { 'Accept-Language': 'pt-BR,pt;q=0.9' },
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver',  { get: () => undefined });
    Object.defineProperty(navigator, 'plugins',    { get: () => [1, 2, 3] });
    Object.defineProperty(navigator, 'languages',  { get: () => ['pt-BR', 'pt'] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).chrome = { runtime: {} };
    // Impede que o site feche a janela (anti-bot detection)
    window.close = () => {};
  });

  // Bloqueia recursos desnecessários para economizar memória e bandwidth
  await context.route('**/*', (route) => {
    const type = route.request().resourceType();
    if (['image', 'media', 'font', 'stylesheet'].includes(type)) {
      route.abort();
    } else {
      route.continue();
    }
  });

  const page = await context.newPage();

  const redeCanaisApi: Record<string, { vendas: number; receita: number }> = {};

  page.on('response', async (response) => {
    try {
      if (response.status() !== 200) return;
      if (!(response.headers()['content-type'] || '').includes('json')) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = await response.json();

      if (response.url().includes('sales-by-source-channel')) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const items: any[] = Array.isArray(data) ? data : (data.data || []);
        for (const item of items) {
          if (typeof item !== 'object') continue;
          const n    = String(item.label || '').trim();
          const v    = parseInt(item.total || 0, 10) || 0;
          const pRaw = item.price || 0;
          const r    = typeof pRaw === 'string' ? parseMoeda(pRaw) : parseFloat(String(pRaw || 0));
          if (n) redeCanaisApi[n] = { vendas: v, receita: r };
        }
        return;
      }

      const achado = buscarCanalReceitaEmJson(data);
      if (achado && Object.keys(achado).length) Object.assign(redeCanaisApi, achado);
    } catch { /* ok */ }
  });

  try {
    urlBase = urlBase.replace(/\/$/, '');
    // 'load' espera o bundle JS (React) ser carregado, não só o HTML inicial
    await page.goto(`${urlBase}/`, { timeout: 60000, waitUntil: 'load' });

    if (!await fazerLogin(page, email, senha)) return errResult('Falha no login');

    await page.goto(`${urlBase}/dashboard`, { timeout: 60000, waitUntil: 'domcontentloaded' });
    try { await page.waitForLoadState('networkidle', { timeout: 40000 }); }
    catch { await page.waitForTimeout(4000); }
    await screenshot(page, '04_dashboard');

    await aplicarFiltroDatas(page, inicio, fim);

    console.log(`  [DEBUG] ${nome}: aguardando dados carregarem...`);
    try {
      await page.waitForFunction(
        () => document.body.innerText.includes('R$') ||
              document.body.innerText.includes('atendimento') ||
              document.body.innerText.includes('Venda'),
        { timeout: 45000 }
      );
      console.log(`  [DEBUG] ${nome}: dados detectados na página`);
    } catch (e: unknown) {
      console.log(`  [DEBUG] ${nome}: timeout aguardando dados: ${(e as Error).message}`);
    }

    const [receita, vendas, totalAtend] = await Promise.all([
      extrairReceita(page),
      extrairVendasBadge(page),
      extrairTotalAtendimentos(page),
    ]);

    if (DEBUG) console.log(`  [DEBUG] ${nome}: receita=${receita} vendas=${vendas} atend=${totalAtend}`);

    const canaisRaw    = await extrairCanaisPizza(page);
    let   canaisVendas = await extrairCanaisBarrasFiber(page);

    if (!Object.keys(canaisVendas).length && Object.keys(redeCanaisApi).length) {
      canaisVendas = { ...redeCanaisApi };
    }

    let receitaFinal = receita;
    let vendasFinal  = vendas;

    if (receitaFinal === 0 && Object.keys(canaisVendas).length) {
      receitaFinal = Object.values(canaisVendas).reduce((s, v) => s + (v.receita || 0), 0);
      console.log(`  [DEBUG] ${nome}: receita derivada dos canais = ${receitaFinal}`);
    }
    if (vendasFinal === 0 && Object.keys(canaisVendas).length) {
      vendasFinal = Object.values(canaisVendas).reduce((s, v) => s + (v.vendas || 0), 0);
      console.log(`  [DEBUG] ${nome}: vendas derivadas dos canais = ${vendasFinal}`);
    }

    const mapeado = mapearCanais(canaisRaw);
    console.log(`  [DEBUG] ${nome}: canais_raw=${JSON.stringify(canaisRaw)}`);
    console.log(`  [DEBUG] ${nome}: canais_vendas=${JSON.stringify(canaisVendas)}`);
    await screenshot(page, '05_final');

    return {
      nome,
      periodoInicio: inicio,
      periodoFim:    fim,
      clientesGoogle:       mapeado.google,
      clientesFacebook:     mapeado.facebook,
      clientesGruposOferta: mapeado.gruposOferta,
      totalAtendimentos:    totalAtend,
      vendasRealizadas:     vendasFinal,
      receitaTotal:         receitaFinal,
      canais:               canaisRaw,
      canaisVendas,
      erro:                 null,
    };
  } catch (e: unknown) {
    return errResult((e as Error).message);
  } finally {
    await context.close();
  }
}

export async function coletarTodas(
  farmacias: (FarmaciaParaColeta & { dias?: number })[],
  _paralelo = 1,
): Promise<DadosFarmacia[]> {
  const resultados: DadosFarmacia[] = [];
  for (let i = 0; i < farmacias.length; i++) {
    const f = farmacias[i];
    console.log(`  [${i + 1}/${farmacias.length}] Coletando ${f.nome}...`);
    const resultado = await coletarFarmacia(f);
    resultados.push(resultado);
    console.log(`  [${i + 1}/${farmacias.length}] ${f.nome}: ${resultado.erro ? 'ERRO' : 'OK'}`);
  }
  return resultados;
}
