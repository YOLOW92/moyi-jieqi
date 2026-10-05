import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  worker: { format: 'iife' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    assetsInlineLimit: 0,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 20000,
  },
});
