import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@main': resolve(__dirname, 'src/main'),
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@test-support': resolve(__dirname, 'test-support')
    }
  },
  test: {
    environment: 'node',
    environmentMatchGlobs: [['src/renderer/**', 'jsdom']],
    globalSetup: ['./vitest.global-setup.ts'],
    setupFiles: ['./vitest.setup.ts'],
    include: [
      'src/**/*.test.{ts,tsx}',
      'test-support/**/*.test.mjs',
      'scripts/pre-commit/**/*.test.mjs'
    ],
    exclude: ['**/node_modules/**', '**/out/**', '**/dist/**', 'e2e/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/**/*.d.ts', 'src/**/test-helpers.ts'],
      reporter: ['text', 'text-summary', 'json-summary']
    }
  }
})
