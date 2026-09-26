// Browser smoke test using isolated synthetic data; never calls the live API.
// UI_BASE_URL=http://localhost:3000 PLAYWRIGHT_ROOT=/tmp/.../node_modules/playwright node reports/personal-ui/verify-ui.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_ROOT || 'playwright');
const baseURL = process.env.UI_BASE_URL || 'http://localhost:3000';
const output = fileURLToPath(new URL('./', import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const checks = [];
const errors = [];
const timestamp = new Date().toISOString();
const devices = [
  { id: 'demo-1', device_key: 'WAPI-DEMO01', label: 'Personal gateway', phone_number: null, status: 'online', health_score: 96, qr_code: null, last_connected: timestamp, created_at: timestamp, updated_at: timestamp },
  { id: 'demo-2', device_key: 'WAPI-DEMO02', label: 'Sandbox device', phone_number: null, status: 'pending_qr', health_score: 100, qr_code: null, last_connected: null, created_at: timestamp, updated_at: timestamp },
];

async function context(options, authenticated = false) {
  const ctx = await browser.newContext({ baseURL, ...options });
  await ctx.addInitScript(({ authenticated }) => {
    localStorage.setItem('theme', 'light');
    if (authenticated) localStorage.setItem('wa_gateway_api_key', 'synthetic-browser-test-only');
  }, { authenticated });
  await ctx.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let data = [];
    if (path === '/api/v1/devices') data = devices;
    if (path === '/api/v1/analytics/overview') data = { total_messages: 0, delivery_rate: 0, avg_response_time: 0, active_devices: 1 };
    if (path === '/api/v1/tenant') data = { id: 'demo', name: 'Synthetic personal workspace', max_devices: 3, quota_messages: 1000, used_messages: 0, status: 'active', created_at: timestamp, updated_at: timestamp };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data, pagination: { total: Array.isArray(data) ? data.length : 0, limit: 100, offset: 0, has_more: false } }) });
  });
  return ctx;
}

async function inspect(page, name, path) {
  await page.goto(path);
  if (!['/login', '/welcome'].includes(path)) {
    // Exercise the login form if an existing hydration race redirects the page.
    await page.waitForTimeout(750);
    if (new URL(page.url()).pathname === '/login') {
      assert.notEqual(process.env.REQUIRE_PERSISTED_AUTH, '1', `${name}: persisted authentication unexpectedly redirected to login`);
      await page.getByLabel('API Key').fill('synthetic-browser-test-only');
      await page.getByRole('button', { name: 'Sign In', exact: true }).click();
      await page.waitForURL(url => url.pathname === '/');
      if (path !== '/') {
        // Client navigation preserves the authenticated snapshot.
        const navLink = page.locator(`a[href="${path}"]`).first();
        if (!(await navLink.isVisible())) await page.getByRole('button', { name: 'Open navigation' }).click();
        await page.locator(`a[href="${path}"]`).filter({ visible: true }).first().click();
      }
    }
    await page.waitForURL(url => url.pathname === path);
    await page.getByRole('heading', { name: path === '/' ? 'Dashboard' : path === '/devices' ? 'Devices' : 'Analytics', exact: true }).first().waitFor();
  }
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  const style = await page.evaluate(() => {
    const body = getComputedStyle(document.body);
    const button = document.querySelector('[data-slot="button"]');
    return {
      font: body.fontFamily,
      weight: body.fontWeight,
      numerals: body.fontVariantNumeric,
      viewport: innerWidth,
      contentWidth: document.documentElement.scrollWidth,
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      buttonTransition: button ? getComputedStyle(button).transitionDuration : null,
    };
  });
  assert.match(style.font, /Inter/i, `${name}: Inter should be the active family`);
  assert.equal(style.weight, '500', `${name}: body weight`);
  assert.equal(style.numerals, 'tabular-nums', `${name}: tabular figures`);
  assert.ok(style.contentWidth <= style.viewport, `${name}: horizontal overflow ${JSON.stringify(style)}`);
  if (style.reducedMotion && style.buttonTransition) assert.equal(style.buttonTransition, '1e-05s');
  await page.screenshot({ path: `${output}${name}.png`, fullPage: true });
  checks.push({ name, path, ...style });
}

try {
  for (const [size, viewport] of Object.entries({ desktop: { width: 1440, height: 1000 }, mobile: { width: 390, height: 844 } })) {
    const publicContext = await context({ viewport });
    const publicPage = await publicContext.newPage();
    publicPage.on('pageerror', error => errors.push(`${size}: ${error.message}`));
    await inspect(publicPage, `${size}-login`, '/login');
    await inspect(publicPage, `${size}-welcome`, '/welcome');
    await publicPage.goto('/');
    await publicPage.waitForURL(url => url.pathname === '/login');
    await publicContext.close();

    const authenticatedContext = await context({ viewport }, true);
    const page = await authenticatedContext.newPage();
    page.on('pageerror', error => errors.push(`${size}: ${error.message}`));
    await inspect(page, `${size}-dashboard`, '/');
    await inspect(page, `${size}-devices`, '/devices');
    await inspect(page, `${size}-analytics`, '/analytics');
    if (size === 'mobile') {
      await page.getByRole('button', { name: 'Open navigation' }).click();
      await page.getByRole('dialog').waitFor();
      await page.screenshot({ path: `${output}mobile-navigation.png`, fullPage: true });
    } else {
      await page.evaluate(() => document.documentElement.classList.add('dark'));
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${output}desktop-analytics-dark.png`, fullPage: true });
    }
    await authenticatedContext.close();
  }
  const reducedContext = await context({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' }, true);
  const reducedPage = await reducedContext.newPage();
  await inspect(reducedPage, 'desktop-reduced-motion', '/devices');
  const runningAnimations = await reducedPage.evaluate(() => document.getAnimations().filter(a => a.playState === 'running').length);
  assert.equal(runningAnimations, 0, 'No motion should remain active with reduced motion');
  assert.equal(errors.length, 0, `Browser errors: ${errors.join('; ')}`);
  await writeFile(`${output}results.json`, JSON.stringify({ baseURL, mockDataOnly: true, checks, runningAnimations, errors }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, errors, output }));
} finally {
  await browser.close();
}
