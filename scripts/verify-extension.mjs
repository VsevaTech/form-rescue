/**
 * End-to-end verification of the built extension in a real Chromium.
 *
 * This is the automated form of the manual check: load `dist/` unpacked, fill
 * the demo form, let autosave run, read `chrome.storage.local` from the
 * extension's own service worker, simulate the crash, restore, and confirm that
 * the 14 safe fields came back while none of the sensitive values were ever
 * stored.
 *
 *   npm run build && npm run verify:extension
 *
 * On Linux without a display, run it under xvfb:
 *   xvfb-run -a npm run verify:extension
 */
import {
  SAFE_VALUES,
  SENSITIVE_VALUES,
  createChecklist,
  fillDemoForm,
  launchWithExtension,
  readStorage,
  requireBuild,
  startDemoServer,
} from './e2e/harness.mjs';

const PORT = Number(process.env.PORT ?? 8123);
const { check, summary } = createChecklist();

requireBuild();
const { server, base } = startDemoServer(PORT);
await new Promise((r) => setTimeout(r, 900));

const { context, worker } = await launchWithExtension();

try {
  check(Boolean(new URL(worker.url()).host), 'extension loaded unpacked', new URL(worker.url()).host);

  const page = await context.newPage();
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);

  check(
    await page.evaluate(() => typeof chrome !== 'undefined'),
    'content script is running on the demo page',
  );

  // --- autosave ----------------------------------------------------------
  await fillDemoForm(page);
  await page.waitForTimeout(1800);

  check(
    await page.evaluate(() => Boolean(document.getElementById('form-rescue-indicator-host'))),
    'page indicator appeared after autosave',
  );

  const storage = await readStorage(worker);
  const serialised = JSON.stringify(storage);
  const draftKeys = Object.keys(storage).filter((k) => k.startsWith('draft:'));

  check(draftKeys.length === 1, 'exactly one draft in chrome.storage.local', draftKeys.join(', '));
  check(draftKeys[0] === `draft:${base}`, 'draft is keyed by origin + pathname', draftKeys[0]);

  const draft = storage[draftKeys[0]];
  check(draft.fields.length === 14, 'draft holds exactly 14 safe fields', `got ${draft.fields.length}`);
  check(draft.skippedSensitive >= 7, 'sensitive controls were counted and dropped', `${draft.skippedSensitive}`);

  for (const [id, value] of Object.entries(SENSITIVE_VALUES)) {
    check(!serialised.includes(value), `no value of ${id} in storage`);
  }
  for (const marker of ['hunter2', '4242', 'csrf', 'cardNumber', 'cvv', 'otp', 'pin_code']) {
    check(!serialised.toLowerCase().includes(marker.toLowerCase()), `no "${marker}" in storage`);
  }
  for (const [id, value] of Object.entries(SAFE_VALUES)) {
    check(serialised.includes(JSON.stringify(value).slice(1, -1)), `safe field ${id} was kept`);
  }

  // --- crash -------------------------------------------------------------
  await page.click('#crash');
  await page.waitForTimeout(1500);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(600);

  const afterCrash = await page.evaluate(() => ({
    name: document.getElementById('full_name').value,
    comment: document.getElementById('comment').value,
    country: document.getElementById('country').value,
  }));
  check(
    Object.values(afterCrash).every((v) => v === ''),
    'form is empty after the simulated crash',
    JSON.stringify(afterCrash),
  );

  // --- restore, through the exact message the popup sends ----------------
  const tabId = await worker.evaluate(
    async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id,
  );
  const response = await worker.evaluate(
    async (id) => chrome.tabs.sendMessage(id, { type: 'FORM_RESCUE_RESTORE' }),
    tabId,
  );
  check(response?.ok === true, 'content script answered the restore message');
  check(
    response?.result?.restored === 14 && response?.result?.skipped === 0,
    'restore reported 14 restored / 0 skipped',
    JSON.stringify(response?.result),
  );

  await page.waitForTimeout(300);
  const after = await page.evaluate(() => {
    const v = (id) => document.getElementById(id).value;
    return {
      safe: Object.fromEntries(
        ['full_name', 'email', 'phone', 'job_title', 'company', 'team_size', 'address', 'city',
          'postal_code', 'start_date', 'comment'].map((id) => [id, v(id)]),
      ),
      country: v('country'),
      newsletter: document.getElementById('newsletter').checked,
      contact: document.querySelector('input[name="preferred_contact"]:checked')?.value ?? null,
      sensitive: Object.fromEntries(
        ['account_password', 'cardNumber', 'cvv', 'otp', 'pin_code'].map((id) => [id, v(id)]),
      ),
    };
  });

  for (const [id, value] of Object.entries(SAFE_VALUES)) {
    check(after.safe[id] === value, `restored ${id}`, after.safe[id]);
  }
  check(after.country === 'ae', 'restored the country select');
  check(after.newsletter === true, 'restored the newsletter checkbox');
  check(after.contact === 'phone', 'restored the preferred_contact radio');
  for (const [id, value] of Object.entries(after.sensitive)) {
    check(value === '', `${id} was NOT restored`, JSON.stringify(value));
  }

  // --- delete ------------------------------------------------------------
  await worker.evaluate(async (key) => chrome.storage.local.remove([key]), draftKeys[0]);
  const remaining = Object.keys(await readStorage(worker));
  check(!remaining.some((k) => k.startsWith('draft:')), 'the draft can be deleted');
} finally {
  await context.close();
  server.kill();
}

process.exit(summary() === 0 ? 0 : 1);
