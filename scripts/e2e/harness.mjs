/**
 * Shared harness for driving the built extension in a real Chromium.
 *
 * Both the verification run and the documentation capture load `dist/` the same
 * way a person does through `chrome://extensions` -> Load unpacked.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const REPO = process.cwd();
export const DIST = resolve(REPO, 'dist');

/** The 14 safe values the demo form is filled with. */
export const SAFE_VALUES = {
  full_name: 'Jeanne Moreau',
  email: 'jeanne@acme.com',
  phone: '+971 50 000 0000',
  job_title: 'Head of Payments',
  company: 'Acme LLC',
  team_size: '42',
  address: '12 Marina Walk',
  city: 'Dubai',
  postal_code: '00000',
  start_date: '2026-10-01',
  comment: 'Twenty minutes of careful typing that you really do not want to do twice.',
};

/** Values that must never reach storage, whatever happens. */
export const SENSITIVE_VALUES = {
  account_password: 'hunter2-super-secret',
  cardNumber: '4242424242424242',
  cvv: '321',
  otp: '998877',
  pin_code: '4821',
};

export function requireBuild() {
  if (!existsSync(join(DIST, 'manifest.json'))) {
    throw new Error('dist/ is missing - run `npm run build` first.');
  }
}

export function startDemoServer(port) {
  const server = spawn(process.execPath, [resolve(REPO, 'scripts/serve-demo.mjs')], {
    cwd: REPO,
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore',
  });
  return { server, base: `http://localhost:${port}/` };
}

/**
 * Launches Chromium with the unpacked extension.
 *
 * Chrome's own password bubble is disabled so it cannot cover the extension
 * popup during capture, and the profile is a throwaway directory.
 */
export async function launchWithExtension({ headless = false, windowSize = '1180,820' } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'form-rescue-'));
  mkdirSync(join(profile, 'Default'), { recursive: true });
  writeFileSync(
    join(profile, 'Default', 'Preferences'),
    JSON.stringify({
      credentials_enable_service: false,
      credentials_enable_autosignin: false,
      profile: { password_manager_enabled: false, password_manager_leak_detection: false },
      autofill: { credit_card_enabled: false, profile_enabled: false },
    }),
  );

  const args = [
    `--disable-extensions-except=${DIST}`,
    `--load-extension=${DIST}`,
    '--no-sandbox',
    '--test-type',
    '--disable-infobars',
    '--hide-crash-restore-bubble',
    '--disable-features=PasswordManagerOnboarding,AutofillServerCommunication,PasswordLeakDetection,OptimizationGuideModelDownloading',
    `--window-size=${windowSize}`,
    '--window-position=0,0',
  ];
  if (headless) args.push('--headless=new');

  const context = await chromium.launchPersistentContext(profile, {
    headless: false, // the flag above selects new headless when requested
    ignoreDefaultArgs: ['--enable-automation'],
    args,
    viewport: null,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  });

  const worker =
    context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 20_000 }));

  return { context, worker, profile };
}

/** Fills the demo form: 14 safe fields plus 5 deliberately sensitive ones. */
export async function fillDemoForm(page, { sensitive = true } = {}) {
  for (const [id, value] of Object.entries(SAFE_VALUES)) await page.fill(`#${id}`, value);
  await page.selectOption('#country', 'ae');
  await page.check('#newsletter');
  await page.check('input[name="preferred_contact"][value="phone"]');
  if (sensitive) {
    for (const [id, value] of Object.entries(SENSITIVE_VALUES)) await page.fill(`#${id}`, value);
  }
}

export async function readStorage(worker) {
  return worker.evaluate(async () => chrome.storage.local.get(null));
}

/** Minimal assertion collector so the scripts need no test runner. */
export function createChecklist() {
  const results = [];
  return {
    check(ok, label, detail = '') {
      results.push({ ok, label, detail });
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` - ${detail}` : ''}`);
      return ok;
    },
    summary() {
      const failed = results.filter((r) => !r.ok);
      console.log(`\n${results.length - failed.length} checks passed, ${failed.length} failed`);
      return failed.length;
    },
  };
}
