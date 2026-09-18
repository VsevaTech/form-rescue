/**
 * Production build: three IIFE bundles plus the static extension assets.
 *
 * Output layout (dist/) is exactly what `Load unpacked` expects.
 */
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'vite';

const root = process.cwd();
const dist = resolve(root, 'dist');

// Icons are drawn from code rather than committed as binaries.
execFileSync(process.execPath, [resolve(root, 'scripts/make-icons.mjs')], { stdio: 'inherit' });

// `content` runs first because it is the target that empties dist/.
const order = ['content', 'background', 'popup'];

for (const mode of order) {
  await build({ configFile: resolve(root, 'vite.config.ts'), mode, logLevel: 'warn' });
  console.log(`built ${mode}.js`);
}

await mkdir(dist, { recursive: true });

const manifest = JSON.parse(await readFile(resolve(root, 'src/manifest.json'), 'utf8'));
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
manifest.version = pkg.version;
await writeFile(resolve(dist, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

await cp(resolve(root, 'src/popup/popup.html'), resolve(dist, 'popup.html'));
await cp(resolve(root, 'src/popup/popup.css'), resolve(dist, 'popup.css'));
await cp(resolve(root, 'public/icons'), resolve(dist, 'icons'), { recursive: true });

console.log('copied manifest.json, popup.html, popup.css, icons/');
console.log(`\ndist/ is ready - load it via chrome://extensions -> Load unpacked`);
