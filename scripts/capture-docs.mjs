/**
 * Produces the screenshots, the GIF and the storage dump used by the README.
 *
 * Everything is captured from the real extension running in a real Chromium:
 * the popup is opened with the extension's own keyboard shortcut and its
 * buttons are clicked with real mouse events, so the pictures in the README
 * show the product rather than a mock-up.
 *
 * Requires a running X display plus `import`/`convert` (ImageMagick), `ffmpeg`
 * and `xdotool`:
 *
 *   npm run build
 *   xvfb-run -a --server-args="-screen 0 1180x820x24" npm run capture:docs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  SENSITIVE_VALUES,
  createChecklist,
  fillDemoForm,
  launchWithExtension,
  readStorage,
  requireBuild,
  startDemoServer,
} from './e2e/harness.mjs';

const DOCS = resolve(process.cwd(), 'docs');
const FRAMES = resolve(process.cwd(), '.capture-frames');
const PORT = Number(process.env.PORT ?? 8126);

/** The popup's accent colour in light mode: the Restore button. */
const ACCENT = [20, 133, 90];
/** Screen area the popup occupies, so page elements are never mistaken for it. */
const POPUP_REGION = { x0: 700, y0: 80, x1: 1180, y1: 440 };

const sh = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });
mkdirSync(DOCS, { recursive: true });

let frame = 0;
const shot = (times = 1) => {
  for (let i = 0; i < times; i += 1) {
    sh('import', ['-window', 'root', join(FRAMES, `f${String(frame++).padStart(3, '0')}.png`)]);
  }
};
const save = (name) => sh('import', ['-window', 'root', join(DOCS, name)]);
const click = (x, y) => {
  sh('xdotool', ['mousemove', String(x), String(y)]);
  sh('xdotool', ['click', '1']);
};
const openPopup = async () => {
  sh('xdotool', ['key', 'alt+shift+f']); // the extension's own _execute_action shortcut
  await wait(1700);
};

/** Locates a coloured control inside the popup by scanning the screen. */
function findInPopup([r, g, b], tolerance = 12) {
  const probe = join(FRAMES, '.probe.png');
  sh('import', ['-window', 'root', probe]);
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1, count = 0;
  for (const line of sh('convert', [probe, 'txt:-']).split('\n')) {
    const m = line.match(/^(\d+),(\d+):\s+\((\d+),(\d+),(\d+)/);
    if (!m) continue;
    const [, xs, ys, pr, pg, pb] = m;
    const x = +xs;
    const y = +ys;
    if (x < POPUP_REGION.x0 || x > POPUP_REGION.x1 || y < POPUP_REGION.y0 || y > POPUP_REGION.y1) continue;
    if (Math.abs(+pr - r) > tolerance || Math.abs(+pg - g) > tolerance || Math.abs(+pb - b) > tolerance) continue;
    count += 1;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  if (count < 200) return null;
  return { x: Math.round((minX + maxX) / 2), y: Math.round((minY + maxY) / 2), box: [minX, minY, maxX, maxY] };
}

const { check, summary } = createChecklist();

requireBuild();
const { server, base } = startDemoServer(PORT);
await wait(900);
const { context, worker } = await launchWithExtension();

try {
  const page = context.pages()[0] ?? (await context.newPage());
  await page.bringToFront();
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await wait(1300);

  // --- fill ---------------------------------------------------------------
  shot(6);
  await fillDemoForm(page, { sensitive: false });
  shot(4);
  save('form-filled.png');

  await page.evaluate(() => document.querySelector('.sensitive').scrollIntoView({ block: 'center' }));
  await wait(350);
  shot(2);
  for (const [id, value] of Object.entries(SENSITIVE_VALUES)) {
    await page.fill(`#${id}`, value);
    shot();
  }
  shot(4);
  await wait(1900);
  shot(4);

  // --- popup shows the draft ---------------------------------------------
  await page.bringToFront();
  await openPopup();
  shot(10);
  save('popup-draft.png');
  check(Boolean(findInPopup(ACCENT)), 'popup opened and rendered the Restore button');

  const storage = await readStorage(worker);
  writeFileSync(join(DOCS, 'storage-example.json'), `${JSON.stringify(storage, null, 2)}\n`);
  const draft = storage[`draft:${base}`];
  check(draft?.fields.length === 14, 'storage dump holds 14 safe fields');
  const serialised = JSON.stringify(storage);
  for (const [id, value] of Object.entries(SENSITIVE_VALUES)) {
    check(!serialised.includes(value), `storage dump carries no value of ${id}`);
  }

  sh('xdotool', ['key', 'Escape']);
  await wait(700);

  // --- crash --------------------------------------------------------------
  await page.bringToFront();
  await page.evaluate(() => window.scrollTo(0, 0));
  await wait(350);
  shot(3);
  await page.click('#crash');
  await wait(380);
  shot(3);
  await wait(1500);
  await page.waitForLoadState('domcontentloaded');
  await wait(900);
  shot(6);
  save('after-crash.png');
  check(await page.evaluate(() => document.getElementById('full_name').value === ''), 'form emptied by the crash');

  // --- the draft survived, restore it by clicking the real button ---------
  await openPopup();
  shot(8);
  save('popup-after-crash.png');

  const restore = findInPopup(ACCENT);
  if (!check(Boolean(restore), 'Restore button located', JSON.stringify(restore?.box))) {
    throw new Error('could not locate the Restore button');
  }
  click(restore.x, restore.y);
  await wait(1700);
  shot(10);
  save('popup-restored.png');

  const after = await page.evaluate(() => ({
    name: document.getElementById('full_name').value,
    password: document.getElementById('account_password').value,
    card: document.getElementById('cardNumber').value,
  }));
  check(after.name !== '', 'clicking Restore refilled the form', after.name);
  check(after.password === '' && after.card === '', 'sensitive fields stayed empty');

  sh('xdotool', ['key', 'Escape']);
  await wait(600);
  await page.bringToFront();
  await page.evaluate(() => window.scrollTo(0, 0));
  await wait(450);
  shot(8);
  await page.evaluate(() => document.querySelector('.sensitive').scrollIntoView({ block: 'center' }));
  await wait(500);
  shot(12);
  save('sensitive-not-restored.png');
} finally {
  await context.close();
  server.kill();
}

// --- assemble the GIF -----------------------------------------------------
sh('ffmpeg', [
  '-y', '-framerate', '7', '-pattern_type', 'glob', '-i', join(FRAMES, 'f*.png'),
  '-vf', 'scale=860:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3',
  '-loop', '0', join(DOCS, 'demo.gif'),
]);
rmSync(FRAMES, { recursive: true, force: true });
console.log(`\nwrote docs/ from ${frame} frames`);

process.exit(summary() === 0 ? 0 : 1);
