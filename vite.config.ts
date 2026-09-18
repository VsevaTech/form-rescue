import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/**
 * Each extension surface is built as a self-contained IIFE bundle.
 *
 * MV3 content scripts cannot be ES modules, so code splitting is deliberately
 * avoided. `scripts/build.mjs` runs this config once per target.
 */
const targets = {
  content: { entry: 'src/content/index.ts', name: 'FormRescueContent' },
  background: { entry: 'src/background/index.ts', name: 'FormRescueBackground' },
  popup: { entry: 'src/popup/popup.ts', name: 'FormRescuePopup' },
} as const;

export type BuildTarget = keyof typeof targets;

export default defineConfig(({ mode }) => {
  const target = (mode in targets ? mode : 'content') as BuildTarget;
  const { entry, name } = targets[target];

  return {
    build: {
      outDir: 'dist',
      // Only the first target in the build order clears the output directory.
      emptyOutDir: target === 'content',
      target: 'chrome110',
      // Extension code stays readable so anyone can audit what it stores.
      minify: false,
      sourcemap: false,
      lib: {
        entry: resolve(process.cwd(), entry),
        name,
        formats: ['iife'],
        fileName: () => `${target}.js`,
      },
    },
    define: { 'process.env.NODE_ENV': '"production"' },
  };
});
