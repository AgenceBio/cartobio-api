module.exports = {
  env: {
    commonjs: true,
    es6: true,
    node: true
  },
  plugins: [
    'jest',
    '@typescript-eslint'
  ],
  extends: [
    'standard',
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:jest/recommended',
    'plugin:jest/style'
  ],
  globals: {
    Atomics: 'readonly',
    SharedArrayBuffer: 'readonly'
  },
  // parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2020
  },
  root: true,
  ignorePatterns: ['**/*.d.ts', 'migrations/**/*.js'],
  rules: {
    'vue/multi-word-component-names': 'off',
    '@typescript-eslint/no-var-requires': 'off',
    '@typescript-eslint/ban-ts-comment': 'off'
  }
}
