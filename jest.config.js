/** @type {import('jest').Config} */
const config = {
  globalSetup: './test/setup.js',
  setupFilesAfterEnv: ['./test/mockDb.js']
}

module.exports = config
