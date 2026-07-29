import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * O preset do Next cobre React e acessibilidade. As regras acrescentadas aqui
 * miram o que mais aparece em código escrito rápido — por pessoa ou por agente:
 * `any` silencioso, variável esquecida, comparação frouxa e `console` sobrando.
 */
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // `any` fecha o olho do compilador justamente onde ele seria útil.
      "@typescript-eslint/no-explicit-any": "error",
      // Sobra de refactor. `_` no começo marca o que é ignorado de propósito.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // `console.error`/`warn` são o canal de log do servidor (o provedor de
      // deploy coleta); um `console.log` esquecido no cliente vaza dado no
      // navegador de quem usa o app.
      "no-console": ["warn", { allow: ["error", "warn"] }],
      // Comparação frouxa esconde bug com `null`/`undefined`/`0`/`""`.
      eqeqeq: ["error", "always", { null: "ignore" }],
      "prefer-const": "error",
      "no-var": "error",
    },
  },
  {
    // Testes rodam no Node e imprimem no terminal de propósito.
    files: ["tests/**/*.ts", "tests/**/*.tsx"],
    rules: {
      "no-console": "off",
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "coverage/**", "next-env.d.ts"]),
]);

export default eslintConfig;
