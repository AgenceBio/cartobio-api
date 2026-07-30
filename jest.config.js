/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'node',

  globalSetup: './test/setup.js',
  setupFilesAfterEnv: ['./test/mockDb.js'],

  testMatch: ['**/*.test.ts', '**/*.test.js'],
  clearMocks: true,
  restoreMocks: true
}

module.exports = config
