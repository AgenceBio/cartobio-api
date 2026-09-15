const { defineConfig, globalIgnores } = require("eslint/config");
const js = require("@eslint/js");
const globals = require("globals");
const tseslint = require("typescript-eslint");
const jest = require("eslint-plugin-jest");

module.exports = defineConfig([
  globalIgnores([
    "**/*.d.ts",
    "migrations/**/*.js",
  ]),

  js.configs.recommended,

  ...tseslint.configs.recommended,

  {
    plugins: {
      jest,
    },

    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      ecmaVersion: 2023,
    },

    rules: {
      "vue/multi-word-component-names": "off",
      "@typescript-eslint/no-var-requires": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-require-imports": "off",
      // TODO : Trop agressif pour l'instant
      "no-useless-assignment": "off",
    },
  },
]);