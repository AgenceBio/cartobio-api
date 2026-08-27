/** @type {import('jest').Config} */
const config = {
  globalSetup: "./test/setup.js",
  setupFilesAfterEnv: ["./test/mockDb.js"],

  testMatch: ["**/*.test.ts", "**/*.test.js"],
};

module.exports = config;
