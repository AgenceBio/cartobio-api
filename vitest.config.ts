import { defineConfig } from 'vitest/config'
import { defaultServerConditions } from 'vite'

export default defineConfig({
  ssr: {
    resolve: {
      conditions: ['source', ...defaultServerConditions.filter(c => c !== 'module')]
    }
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globalSetup: ['./test/setup.ts'],
    setupFiles: ['./test/mockDb.ts'],
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      reporter: ['html', 'text-summary', 'lcovonly']
    }
  }
})
