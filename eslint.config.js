import { defineConfig, globalIgnores } from 'eslint/config'
import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import eslintConfigPrettier from 'eslint-config-prettier/flat'

export default defineConfig([
  globalIgnores([
    '**/*.d.ts',
    '**/dist/**',
    'coverage/**',
    'database/old_migrations/**/*.js'
  ]),

  js.configs.recommended,

  ...tseslint.configs.recommended,

  {
    languageOptions: {
      globals: {
        ...globals.node
      },
      ecmaVersion: 2023
    },

    rules: {
      '@typescript-eslint/ban-ts-comment': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      'no-useless-assignment': 'off'
    }
  },

  {
    files: ['src/**/*.ts', 'bin/**/*.ts', 'packages/cartobio-types/src/**/*.ts'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': ['error', { allowExpressions: true, allowTypedFunctionExpressions: true }]
    }
  },

  {
    files: ['test/**/*.ts', '__mocks__/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.vitest
      }
    },
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off'
    }
  },

  eslintConfigPrettier
])
