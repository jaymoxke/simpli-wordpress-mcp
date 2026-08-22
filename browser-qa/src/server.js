import express from 'express';
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const app = express();
app.use(express.json({ limit: '256kb' }));

const PORT = Number(process.env.PORT || 3000);
const API_TOKEN = process.env.SIMPLI_BROWSER_QA_TOKEN || '';
const allowedHosts = new Set(
  (process.env.SIMPLI_ALLOWED_HOSTS || 'www.simplicosmetics.co.ke,simplicosmetics.co.ke')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean)
);
const restrictedPathPrefixes = ['/checkout', '/my-account', '/wp-admin', '/wp-login.php'];

function requireAuth(req, res, next) {
  if (!API_TOKEN) return res.status(503).json({ error: 'SERVICE_NOT_CONFIGURED' });
  const value = req.get('authorization') || '';
  if (value !== `Bearer ${API_TOKEN}`) return res.status(401).json({ error: 'UNAUTHORIZED' });
  next();
}

function assertAllowedPageUrl(raw, errorPrefix = 'TARGET') {
  let parsed;
  try {
    parsed = new URL(String(raw || ''));
  } catch {
    throw new Error(`${errorPrefix}_INVALID_URL`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`${errorPrefix}_HTTPS_REQUIRED`);
  if (!allowedHosts.has(parsed.hostname.toLowerCase())) throw new Error(`${errorPrefix}_HOST_NOT_ALLOWED`);
  if (parsed.username || parsed.password) throw new Error(`${errorPrefix}_URL_CREDENTIALS_NOT_ALLOWED`);
  const path = parsed.pathname.toLowerCase();
  if (restrictedPathPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
    throw new Error(`${errorPrefix}_RESTRICTED_PATH`);
  }
  return parsed;
}

function validateTarget(raw) {
  return assertAllowedPageUrl(raw).toString();
}

function viewportFor(name) {
  if (name === 'mobile') return { width: 390, height: 844 };
  if (name === 'tablet') return { width: 834, height: 1112 };
  return { width: 1440, height: 1000 };
}

async function runActions(page, actions = []) {
  if (!Array.isArray(actions) || actions.length > 20) throw new Error('INVALID_ACTIONS');
  const results = [];
  for (const action of actions) {
    const type = String(action?.type || '');
    const selector = String(action?.selector || '');
    if (!selector || selector.length > 500) throw new Error('INVALID_SELECTOR');
    const locator = page.locator(selector).first();
    if (type === 'click') {
      await locator.click({ timeout: 10000 });
    } else if (type === 'fill') {
      await locator.fill(String(action.value ?? ''), { timeout: 10000 });
    } else if (type === 'select') {
      await locator.selectOption(String(action.value ?? ''), { timeout: 10000 });
    } else if (type === 'check') {
      await locator.check({ timeout: 10000 });
    } else if (type === 'press') {
      await locator.press(String(action.value ?? 'Enter'), { timeout: 10000 });
    } else if (type === 'waitVisible') {
      await locator.waitFor({ state: 'visible', timeout: Math.min(Number(action.timeout || 10000), 20000) });
    } else {
      throw new Error('ACTION_NOT_ALLOWED');
    }
    assertAllowedPageUrl(page.url(), 'NAVIGATION');
    results.push({ type, selector, ok: true, url: page.url() });
  }
  return results;
}

async function withPage(body, callback) {
  const target = validateTarget(body?.url);
  const viewport = viewportFor(String(body?.viewport || 'desktop'));
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport,
    locale: 'en-KE',
    timezoneId: 'Africa/Nairobi',
    serviceWorkers: 'block'
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 1000)); });
  page.on('pageerror', (err) => pageErrors.push(String(err.message || err).slice(0, 1000)));
  page.on('requestfailed', (req) => failedRequests.push({ url: req.url().slice(0, 1000), error: req.failure()?.errorText || 'FAILED' }));
  page.on('dialog', (dialog) => dialog.dismiss().catch(() => {}));
  page.on('download', (download) => download.cancel().catch(() => {}));

  try {
    const response = await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    assertAllowedPageUrl(page.url(), 'NAVIGATION');
    return await callback({ page, context, response, viewport, consoleErrors, pageErrors, failedRequests });
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

app.get('/health', async (_req, res) => {
  let browserReady = false;
  try {
    const browser = await chromium.launch({ headless: true });
    browserReady = true;
    await browser.close();
  } catch {}
  res.status(browserReady ? 200 : 503).json({
    service: 'simpli-browser-qa',
    version: '0.2.0',
    browserReady,
    targetPolicy: 'SIMPLI_HTTPS_PUBLIC_STOREFRONT_ONLY',
    restrictedPaths: restrictedPathPrefixes
  });
});

app.post('/v1/inspect', requireAuth, async (req, res) => {
  try {
    const result = await withPage(req.body, async ({ page, response, viewport, consoleErrors, pageErrors, failedRequests }) => {
      const actions = await runActions(page, req.body.actions || []);
      const state = await page.evaluate(() => ({
        title: document.title,
        h1: Array.from(document.querySelectorAll('h1')).map((n) => n.textContent?.trim()).filter(Boolean),
        h2: Array.from(document.querySelectorAll('h2')).map((n) => n.textContent?.trim()).filter(Boolean).slice(0, 100),
        buttons: Array.from(document.querySelectorAll('button')).map((n) => ({ text: n.textContent?.trim() || '', disabled: n.disabled, ariaLabel: n.getAttribute('aria-label') || '' })).slice(0, 100),
        links: Array.from(document.querySelectorAll('a[href]')).length,
        forms: document.querySelectorAll('form').length,
        images: Array.from(document.images).map((img) => ({ alt: img.alt, complete: img.complete, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight })).slice(0, 100),
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        bodyTextSample: (document.body?.innerText || '').slice(0, 4000)
      }));
      return {
        state: 'STATE_VERIFIED',
        url: page.url(),
        status: response?.status() ?? null,
        viewport,
        overflowX: state.scrollWidth > state.clientWidth + 2,
        actions,
        consoleErrors: consoleErrors.slice(0, 50),
        pageErrors: pageErrors.slice(0, 50),
        failedRequests: failedRequests.slice(0, 100),
        page: state
      };
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: String(error?.message || error).slice(0, 500) });
  }
});

app.post('/v1/accessibility', requireAuth, async (req, res) => {
  try {
    const result = await withPage(req.body, async ({ page, response, viewport }) => {
      await runActions(page, req.body.actions || []);
      const report = await new AxeBuilder({ page }).analyze();
      return {
        state: 'STATE_VERIFIED',
        url: page.url(),
        status: response?.status() ?? null,
        viewport,
        violationCount: report.violations.length,
        violations: report.violations.slice(0, 50).map((v) => ({
          id: v.id,
          impact: v.impact,
          help: v.help,
          helpUrl: v.helpUrl,
          nodes: v.nodes.slice(0, 20).map((n) => ({ target: n.target, html: n.html.slice(0, 1000), failureSummary: n.failureSummary }))
        }))
      };
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: String(error?.message || error).slice(0, 500) });
  }
});

app.post('/v1/screenshot', requireAuth, async (req, res) => {
  try {
    const png = await withPage(req.body, async ({ page }) => {
      await runActions(page, req.body.actions || []);
      return page.screenshot({ fullPage: Boolean(req.body.fullPage), type: 'png' });
    });
    res.type('png').send(png);
  } catch (error) {
    res.status(400).json({ error: String(error?.message || error).slice(0, 500) });
  }
});

app.use((_req, res) => res.status(404).json({ error: 'NOT_FOUND' }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`simpli-browser-qa listening on ${PORT}`);
});
