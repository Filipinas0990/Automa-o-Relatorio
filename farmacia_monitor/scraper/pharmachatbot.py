import re
import asyncio
import os
from datetime import datetime, timedelta
from dataclasses import dataclass, field
from typing import Optional
from playwright.async_api import async_playwright, Page, Browser

DEBUG_SCREENSHOTS = os.getenv("DEBUG_SCREENSHOTS", "false").lower() == "true"
DEBUG_DIR = "/app/logs/debug_screenshots"


@dataclass
class DadosFarmacia:
    nome: str
    periodo_inicio: str
    periodo_fim: str
    # Origem dos clientes (canal de divulgação)
    clientes_google: int = 0
    clientes_facebook: int = 0
    clientes_grupos_oferta: int = 0
    total_atendimentos: int = 0
    # Vendas
    vendas_realizadas: int = 0      # quantidade
    receita_total: float = 0.0      # faturamento total R$
    # Todos os canais coletados (para armazenar breakdown completo)
    canais: dict = field(default_factory=dict)
    erro: Optional[str] = None


def _parse_moeda(texto: str) -> float:
    limpo = re.sub(r"[R$\s]", "", texto).replace(".", "").replace(",", ".")
    try:
        return float(limpo)
    except ValueError:
        return 0.0


def _parse_inteiro(texto: str) -> int:
    limpo = re.sub(r"\D", "", texto)
    return int(limpo) if limpo else 0


async def _screenshot(page: Page, nome: str):
    if not DEBUG_SCREENSHOTS:
        return
    try:
        os.makedirs(DEBUG_DIR, exist_ok=True)
        ts = datetime.now().strftime("%H%M%S")
        path = f"{DEBUG_DIR}/{ts}_{nome}.png"
        await page.screenshot(path=path, full_page=True, timeout=8000)
        print(f"  [DEBUG] screenshot: {path}")
    except Exception as ex:
        print(f"  [DEBUG] screenshot falhou: {ex}")


async def _fazer_login(page: Page, email: str, senha: str) -> bool:
    print(f"  [DEBUG] URL atual: {page.url}")
    print(f"  [DEBUG] tentando login: {email}")

    # Coleta respostas de rede para diagnóstico
    _respostas = []
    page.on("response", lambda r: _respostas.append(f"{r.status} {r.url}"))
    page.on("console", lambda m: print(f"  [CONSOLE] {m.type}: {m.text}") if m.type in ("error", "warning") else None)

    # Espera campo de email aparecer + React hidratar
    try:
        await page.wait_for_selector('input[type="email"]', timeout=15000)
        await page.wait_for_timeout(2000)  # React precisa de tempo para hidratar
    except Exception:
        print("  [DEBUG] campo email nao encontrado")
        html = await page.content()
        print(html[:3000])
        return False

    await _screenshot(page, "01_pre_login")

    # Usa page.fill() — método correto para inputs React controlados
    await page.fill('input[type="email"]', email)
    await page.wait_for_timeout(400)
    await page.fill('input[type="password"]', senha)
    await page.wait_for_timeout(600)

    # Verifica se os campos foram preenchidos
    val_email = await page.input_value('input[type="email"]')
    val_senha = await page.input_value('input[type="password"]')
    print(f"  [DEBUG] campos: email={repr(val_email[:10]+'...')} senha={'*'*len(val_senha)}")

    await _screenshot(page, "02_pre_submit")

    # Clica no botão de submit
    botao = page.locator(
        'button:has-text("Entrar"), button:has-text("Sign In"), button[type="submit"]'
    )
    n_botoes = await botao.count()
    print(f"  [DEBUG] botoes encontrados: {n_botoes}")
    if n_botoes > 0:
        await botao.first.click()
    else:
        await page.keyboard.press("Enter")

    await page.wait_for_timeout(2000)

    # Loga respostas de rede capturadas
    for r in _respostas[-10:]:
        print(f"  [NET] {r}")

    # Palavras da tela de login em PT e EN
    _PALAVRAS_LOGIN = ("esqueci minha senha", "lembrar-me", "forget my password", "remember me")

    def _esta_no_login(texto: str) -> bool:
        t = texto.lower()
        return any(p in t for p in _PALAVRAS_LOGIN)

    # Polling: aguarda sair do login (máx 30s)
    for i in range(30):
        await page.wait_for_timeout(1000)
        try:
            corpo = (await page.locator("body").text_content(timeout=3000) or "")
            if not _esta_no_login(corpo):
                print(f"  [DEBUG] login OK em {i+1}s, URL: {page.url}")
                await _screenshot(page, "03_dashboard")
                return True
            # Verifica se apareceu mensagem de erro
            erros = [ln for ln in corpo.splitlines()
                     if any(w in ln.lower() for w in ("incorret", "inválid", "erro", "error", "invalid"))]
            if erros:
                print(f"  [DEBUG] mensagem de erro na pagina: {erros[:3]}")
        except Exception:
            pass

    corpo = (await page.locator("body").text_content(timeout=3000) or "")
    print(f"  [DEBUG] login FALHOU. URL: {page.url}")
    print(f"  [DEBUG] conteudo:\n{corpo[:2000]}")
    print(f"  [DEBUG] ultimas respostas de rede:")
    for r in _respostas[-15:]:
        print(f"    {r}")
    await _screenshot(page, "03_login_falhou")
    return False


async def _aplicar_filtro_datas(page: Page, inicio: str, fim: str):
    filtros_btn = page.locator(
        'button:has-text("Filtros"), span:has-text("Filtros"), '
        'button:has-text("Filters"), span:has-text("Filters")'
    )
    if await filtros_btn.count() > 0:
        await filtros_btn.first.click()
        await page.wait_for_timeout(800)

    date_inputs = page.locator('input[type="date"]')
    if await date_inputs.count() < 2:
        date_inputs = page.locator(
            'input[placeholder*="/"], input[placeholder*="-"], input[class*="date"]'
        )

    d_inicio  = datetime.strptime(inicio, "%Y-%m-%d")
    d_fim     = datetime.strptime(fim,    "%Y-%m-%d")
    br_inicio = d_inicio.strftime("%d/%m/%Y")
    br_fim    = d_fim.strftime("%d/%m/%Y")

    if await date_inputs.count() >= 2:
        try:
            await date_inputs.nth(0).fill(inicio, timeout=5000)
            await date_inputs.nth(1).fill(fim,    timeout=5000)
        except Exception:
            await date_inputs.nth(0).click(click_count=3)
            await date_inputs.nth(0).type(br_inicio)
            await date_inputs.nth(1).click(click_count=3)
            await date_inputs.nth(1).type(br_fim)

    salvar_btn = page.locator('button:has-text("Salvar"), button:has-text("Save")')
    if await salvar_btn.count() > 0:
        await salvar_btn.first.click()

    await page.wait_for_load_state("networkidle", timeout=20000)
    await page.wait_for_timeout(1500)

    # Fecha o painel com Escape
    try:
        if await page.locator('input[type="date"]').is_visible():
            await page.keyboard.press("Escape")
            await page.wait_for_timeout(600)
    except Exception:
        pass

    await _screenshot(page, "04_apos_filtro")


async def _extrair_canais_pizza(page: Page, titulo: str) -> dict:
    """
    Extrai dados do gráfico de pizza via React fiber (Recharts).
    Método 1: lê props do componente React diretamente.
    Método 2 (fallback): hover nas fatias + leitura de tooltip.
    """
    # Rola até o gráfico ficar visível
    await page.evaluate(f"""
        const els = [...document.querySelectorAll('*')];
        const el = els.find(e => (e.innerText || '').includes('canal de divulga'));
        if (el) el.scrollIntoView({{behavior: 'instant', block: 'center'}});
    """)
    await page.wait_for_timeout(800)

    # ── Método 1: React fiber ────────────────────────────────────────────────
    canais = await page.evaluate("""
        () => {
            function getFiberKey(el) {
                return Object.keys(el).find(k =>
                    k.startsWith('__reactFiber') ||
                    k.startsWith('__reactInternalInstance')
                );
            }
            function walkFiber(fiber, depth) {
                if (!fiber || depth > 30) return [];
                const out = [];
                const props = fiber.memoizedProps || {};
                // Procura array de dados com campo "nome" ou "name"
                if (Array.isArray(props.data)) {
                    props.data.forEach(d => {
                        const nome  = d.nome || d.name || d.label || '';
                        const total = d.total || d.value || d.count || 0;
                        if (nome && total > 0) out.push([String(nome), Number(total)]);
                    });
                }
                if (fiber.child)   out.push(...walkFiber(fiber.child,   depth + 1));
                if (fiber.sibling) out.push(...walkFiber(fiber.sibling, depth + 1));
                return out;
            }
            // Encontra o SVG dentro do container do gráfico de canais
            const headings = [...document.querySelectorAll('*')].filter(
                e => (e.innerText || '').trim().includes('canal de divulga') &&
                     e.children.length === 0
            );
            const resultados = {};
            for (const h of headings) {
                // Sobe até encontrar um ancestral com SVG
                let container = h.parentElement;
                for (let i = 0; i < 8; i++) {
                    if (!container) break;
                    const svg = container.querySelector('svg');
                    if (svg) {
                        const key = getFiberKey(svg);
                        if (key) {
                            walkFiber(svg[key], 0).forEach(([nome, total]) => {
                                resultados[nome] = total;
                            });
                        }
                        // Também tenta em cada path
                        svg.querySelectorAll('path').forEach(p => {
                            const k = getFiberKey(p);
                            if (!k) return;
                            walkFiber(p[k], 0).forEach(([nome, total]) => {
                                resultados[nome] = total;
                            });
                        });
                        break;
                    }
                    container = container.parentElement;
                }
            }
            return resultados;
        }
    """)

    if canais and any(v > 0 for v in canais.values()):
        return canais

    # ── Método 2: hover nas fatias ───────────────────────────────────────────
    heading = page.locator("text=canal de divulga").first
    if await heading.count() == 0:
        return {}

    container = heading.locator("xpath=ancestor::div[.//svg][1]")
    if await container.count() == 0:
        return {}

    fatias = container.locator("svg path[fill]:not([fill='none'])")
    total_fatias = await fatias.count()
    vistos = set()

    for i in range(total_fatias):
        try:
            await fatias.nth(i).hover(force=True, timeout=3000)
            await page.wait_for_timeout(400)

            # Tenta qualquer elemento de tooltip visível
            tooltip = page.locator(
                '[class*="recharts-tooltip-wrapper"], '
                '[class*="tooltip"], [class*="Tooltip"]'
            ).filter(has_text=re.compile(r'\d+'))

            if await tooltip.count() == 0:
                continue

            texto = (await tooltip.first.text_content(timeout=2000) or "").strip()
            if not texto or texto in vistos:
                continue
            vistos.add(texto)

            nome_m  = re.search(r"nome[:\s]+(.+?)(?:\n|total|$)", texto, re.IGNORECASE)
            total_m = re.search(r"total[:\s]+([\d.,]+)",           texto, re.IGNORECASE)
            if nome_m and total_m:
                nome  = nome_m.group(1).strip()
                total = _parse_inteiro(total_m.group(1))
                if nome and total > 0:
                    canais[nome] = total
        except Exception:
            continue

    return canais


async def _extrair_receita(page: Page) -> float:
    try:
        corpo = await page.locator("body").text_content(timeout=5000)
        match = re.search(r"R\$\s*[\d.,]+", corpo or "")
        if match:
            return _parse_moeda(match.group())
    except Exception:
        pass
    return 0.0


async def _extrair_vendas_badge(page: Page) -> int:
    """Extrai o badge 'Vendas realizadas' da sidebar."""
    badges_dom = await page.evaluate("""
        () => {
            const resultado = [];
            document.querySelectorAll('*').forEach(el => {
                const txt = el.innerText || '';
                if (el.children.length === 0 && /^\\d+$/.test(txt.trim()) && parseInt(txt) > 0) {
                    const pai = el.parentElement;
                    const labelEl = pai ? pai.querySelector('*:not(:first-child)') : null;
                    const label = labelEl ? (labelEl.innerText || '').trim() : '';
                    const avo = pai ? pai.parentElement : null;
                    const labelAvo = avo ? (avo.innerText || '').trim() : '';
                    resultado.push({
                        numero: parseInt(txt.trim()),
                        label: label || labelAvo.replace(txt.trim(), '').trim()
                    });
                }
            });
            return resultado;
        }
    """)

    for b in badges_dom:
        label = (b.get("label") or "").lower()
        num   = b.get("numero", 0)
        if ("venda" in label or "sale" in label) and "não" not in label and "nao" not in label:
            return num
    return 0


async def _extrair_total_atendimentos(page: Page) -> int:
    badges_dom = await page.evaluate("""
        () => {
            const resultado = [];
            document.querySelectorAll('*').forEach(el => {
                const txt = el.innerText || '';
                if (el.children.length === 0 && /^\\d+$/.test(txt.trim()) && parseInt(txt) > 10) {
                    const pai = el.parentElement;
                    const labelEl = pai ? pai.querySelector('*:not(:first-child)') : null;
                    const label = labelEl ? (labelEl.innerText || '').trim() : '';
                    const avo = pai ? pai.parentElement : null;
                    const labelAvo = avo ? (avo.innerText || '').trim() : '';
                    resultado.push({
                        numero: parseInt(txt.trim()),
                        label: label || labelAvo.replace(txt.trim(), '').trim()
                    });
                }
            });
            return resultado;
        }
    """)

    for b in badges_dom:
        label = (b.get("label") or "").lower()
        num   = b.get("numero", 0)
        if "total" in label and "atendimento" in label:
            return num
    return 0


def _mapear_canais(canais: dict) -> dict:
    """
    Mapeia os nomes variáveis do PharmaChatBot para campos padronizados.
    Suporta variações de nome (pt/en, maiúsculas, etc.).
    """
    google   = 0
    facebook = 0
    grupos   = 0

    for nome, total in canais.items():
        n = nome.lower()
        if "google" in n:
            google += total
        elif "facebook" in n or "instagram" in n or "meta" in n:
            facebook += total
        elif "grupo" in n or "oferta" in n or "group" in n:
            grupos += total

    return {"google": google, "facebook": facebook, "grupos_oferta": grupos}


async def coletar_farmacia(
    nome: str,
    url_base: str,
    email: str,
    senha: str,
    browser: Browser,
    dias: int = 7,
) -> DadosFarmacia:
    hoje   = datetime.now()
    inicio = (hoje - timedelta(days=dias)).strftime("%Y-%m-%d")
    fim    = hoje.strftime("%Y-%m-%d")

    context = await browser.new_context(
        locale="pt-BR",
        timezone_id="America/Sao_Paulo",
        viewport={"width": 1366, "height": 768},
        user_agent=(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
        extra_http_headers={"Accept-Language": "pt-BR,pt;q=0.9"},
    )

    # Remove marcadores de automação detectados por SPAs
    await context.add_init_script("""
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
        Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR', 'pt'] });
        window.chrome = { runtime: {} };
    """)

    # Bloqueia fontes externas para acelerar carregamento no servidor
    await context.route(
        "**/fonts.googleapis.com/**",
        lambda route: route.abort(),
    )
    await context.route(
        "**/fonts.gstatic.com/**",
        lambda route: route.abort(),
    )

    page = await context.new_page()

    try:
        url_base = url_base.rstrip("/")
        await page.goto(f"{url_base}/", timeout=20000)

        if not await _fazer_login(page, email, senha):
            return DadosFarmacia(
                nome=nome, periodo_inicio=inicio, periodo_fim=fim,
                erro="Falha no login",
            )

        # Login redireciona para /newsletter — navega para o painel de analytics
        print(f"  [DEBUG] {nome}: pos-login={page.url}")

        # Tenta /dashboard primeiro; se redirecionar para login, tenta /reports
        for tentativa in ("/dashboard", "/reports", "/home", "/"):
            destino = f"{url_base}{tentativa}"
            print(f"  [DEBUG] {nome}: tentando {destino}")
            await page.goto(destino, timeout=30000)
            await page.wait_for_load_state("networkidle", timeout=20000)
            await page.wait_for_timeout(2000)
            corpo = (await page.locator("body").text_content(timeout=5000) or "").lower()
            ainda_login = any(p in corpo for p in ("esqueci minha senha", "forget my password"))
            print(f"  [DEBUG] {nome}: URL={page.url} | login={ainda_login}")
            if not ainda_login:
                break

        await _screenshot(page, "04_dashboard")

        await _aplicar_filtro_datas(page, inicio, fim)

        # Espera o SPA terminar de carregar os dados (máx 45s)
        print(f"  [DEBUG] {nome}: aguardando dados carregarem...")
        try:
            await page.wait_for_function(
                "document.body.innerText.includes('R$') || "
                "document.body.innerText.includes('atendimento') || "
                "document.body.innerText.includes('Venda')",
                timeout=45000,
            )
            print(f"  [DEBUG] {nome}: dados detectados na página")
        except Exception as e:
            print(f"  [DEBUG] {nome}: timeout aguardando dados: {e}")
            try:
                txt = await page.locator("body").text_content(timeout=5000)
                print(f"  [DEBUG] {nome}: conteudo da pagina:\n{(txt or '')[:2000]}")
            except Exception:
                pass
            await _screenshot(page, "05_sem_dados")

        # Coleta em paralelo: receita + vendas badge + total atendimentos
        receita, vendas, total_atend = await asyncio.gather(
            _extrair_receita(page),
            _extrair_vendas_badge(page),
            _extrair_total_atendimentos(page),
        )
        print(f"  [DEBUG] {nome}: receita={receita} vendas={vendas} atend={total_atend}")

        # Extrai dados do gráfico de canais de divulgação
        canais_raw = await _extrair_canais_pizza(
            page, "Quantidade de atendimentos por canal de divulga"
        )
        mapeado = _mapear_canais(canais_raw)
        print(f"  [DEBUG] {nome}: canais_raw={canais_raw}")
        await _screenshot(page, "05_final")

        return DadosFarmacia(
            nome=nome,
            periodo_inicio=inicio,
            periodo_fim=fim,
            clientes_google=mapeado["google"],
            clientes_facebook=mapeado["facebook"],
            clientes_grupos_oferta=mapeado["grupos_oferta"],
            total_atendimentos=total_atend,
            vendas_realizadas=vendas,
            receita_total=receita,
            canais=canais_raw,
        )

    except Exception as e:
        return DadosFarmacia(
            nome=nome, periodo_inicio=inicio, periodo_fim=fim, erro=str(e)
        )
    finally:
        await context.close()


async def coletar_todas(farmacias: list[dict], paralelo: int = 5) -> list[DadosFarmacia]:
    resultados = []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--disable-blink-features=AutomationControlled",
                "--disable-infobars",
                "--window-size=1366,768",
            ],
        )

        for i in range(0, len(farmacias), paralelo):
            lote = farmacias[i: i + paralelo]
            tarefas = [
                coletar_farmacia(
                    nome=f["nome"],
                    url_base=f["url_base"],
                    email=f["email"],
                    senha=f["senha"],
                    browser=browser,
                )
                for f in lote
            ]
            resultados_lote = await asyncio.gather(*tarefas)
            resultados.extend(resultados_lote)
            print(f"  Lote {i // paralelo + 1} OK ({len(resultados)}/{len(farmacias)})")

        await browser.close()

    return resultados
