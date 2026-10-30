import { useSyncExternalStore } from "react";

import { THEME_ATTRIBUTE, currentThemeMode, type ThemeMode } from "./theme";

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [THEME_ATTRIBUTE],
  });
  return () => observer.disconnect();
}

/**
 * O modo atual (claro ou escuro), re-renderizando quando o atributo do `<html>`
 * muda. Só em componente de cliente.
 *
 * Observa o ATRIBUTO, e não um evento de quem o trocou: assim quem lê não
 * depende de quem escreve avisar — e o atributo continua sendo a única fonte de
 * verdade do tema (ver `./theme.ts`).
 *
 * No servidor é sempre "dark" (o tema padrão); a hidratação corrige para o que o
 * script de antes da pintura aplicou.
 */
export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(subscribe, currentThemeMode, () => "dark");
}
