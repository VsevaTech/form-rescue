import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    environmentOptions: { jsdom: { url: 'https://forms.example.com/apply' } },
    globals: true,
    include: ['tests/**/*.test.ts'],
    restoreMocks: true,
  },
});
