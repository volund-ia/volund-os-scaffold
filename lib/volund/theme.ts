/**
 * Claro e escuro (contrato 9): quem decide, como chega na tela e como o resto
 * do App fica sabendo.
 *
 * ## O tema é UM atributo, e ele é a única fonte de verdade
 *
 * Claro é `data-tema="claro"` no `<html>`; escuro é a ausência dele. É a mesma
 * convenção do painel do VolundOS (docs/tema-claro.md de lá), e é o que faz o
 * `css` da marca da organização — que já vem com o bloco
 * `html:root[data-tema="claro"]` — funcionar aqui sem tradução.
 *
 * Quem precisa saber o tema (o `Toaster`, o chat embutido) LÊ o atributo e
 * observa as mudanças dele. Ninguém guarda uma cópia: duas cópias do tema
 * divergem, e a tela fica meio clara.
 *
 * ## Quem decide
 *
 * 1. Dentro do painel do VolundOS, o PAINEL: ele manda
 *    `{ source: "volund-panel", type: "theme", mode }` (contracts/frame-protocol.json,
 *    `panelToAppTheme`). Assim o App acompanha o que a pessoa escolheu no Perfil,
 *    e não o aparelho.
 * 2. Fora dele (o App aberto numa aba), o aparelho: `prefers-color-scheme`, ao
 *    vivo.
 *
 * Este módulo não importa nada — nem do servidor, nem do React: é usado pelo
 * layout (o script de antes da pintura), que é Server Component, e pelos
 * componentes de cliente. O hook mora em `./use-theme-mode.ts`, porque o build
 * de servidor do React não tem os hooks e o import quebraria o layout.
 */

export type ThemeMode = "light" | "dark";

export const THEME_ATTRIBUTE = "data-tema";
export const THEME_LIGHT_VALUE = "claro";

/**
 * Onde a última escolha do painel fica guardada, na aba. Só serve ao script de
 * antes da pintura: recarregar o App dentro do painel nasce no tema do painel,
 * em vez de nascer no do aparelho e trocar quando o painel responder.
 */
export const PANEL_THEME_STORAGE_KEY = "volund:tema-do-painel";

/**
 * Roda no `<head>`, antes da primeira pintura. Sem ele, quem está no claro veria
 * a página nascer escura e trocar depois da hidratação.
 *
 * Escrito à mão e curto porque vai inline em toda página. Ele faz o mesmo que
 * `applyThemeMode` + `systemThemeMode`, sem depender de nada carregado.
 */
export const THEME_BEFORE_PAINT_SCRIPT = `(function(){try{var m=null;if(window.parent!==window){try{m=sessionStorage.getItem(${JSON.stringify(PANEL_THEME_STORAGE_KEY)})}catch(e){}}if(m!=="light"&&m!=="dark"){m=window.matchMedia&&window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"}var h=document.documentElement;if(m==="light"){h.setAttribute(${JSON.stringify(THEME_ATTRIBUTE)},${JSON.stringify(THEME_LIGHT_VALUE)})}else{h.removeAttribute(${JSON.stringify(THEME_ATTRIBUTE)})}}catch(e){}})();`;

/** O modo que o atributo diz agora. Sem documento (servidor), escuro. */
export function currentThemeMode(): ThemeMode {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.getAttribute(THEME_ATTRIBUTE) === THEME_LIGHT_VALUE
    ? "light"
    : "dark";
}

/** Aplica o modo no `<html>`. Idempotente: não mexe se já está certo. */
export function applyThemeMode(mode: ThemeMode): void {
  const html = document.documentElement;
  if (mode === "light") {
    if (html.getAttribute(THEME_ATTRIBUTE) !== THEME_LIGHT_VALUE) {
      html.setAttribute(THEME_ATTRIBUTE, THEME_LIGHT_VALUE);
    }
  } else if (html.hasAttribute(THEME_ATTRIBUTE)) {
    html.removeAttribute(THEME_ATTRIBUTE);
  }
}

/** O modo do aparelho. */
export function systemThemeMode(): ThemeMode {
  return window.matchMedia?.("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

/**
 * A mensagem de tema do painel, conferida — ou `null`.
 *
 * As três conferências são o contrato, e cada uma fecha uma porta:
 *
 * - **origem exata do painel** (`VOLUND_OIDC_ISSUER`): qualquer outra página
 *   que emoldurasse o App poderia mudar a aparência dele;
 * - **a janela é a que emoldura este App** (`window.parent`): um quadro irmão
 *   servido pelo mesmo painel não é quem decide;
 * - **forma e valor**: só `light` e `dark`. "system" não existe nesta direção —
 *   quem resolve o "Sistema" da pessoa é o painel, que manda o resultado.
 *
 * Pura, para poder ser exercitada sem navegador.
 */
export function readPanelThemeMessage(
  event: { origin: string; source: unknown; data: unknown },
  parentOrigin: string | null,
  parentWindow: unknown,
): ThemeMode | null {
  if (!parentOrigin) return null;
  if (event.origin !== parentOrigin) return null;
  if (event.source !== parentWindow) return null;
  const data = event.data as {
    source?: unknown;
    type?: unknown;
    mode?: unknown;
  } | null;
  if (!data || typeof data !== "object") return null;
  if (data.source !== "volund-panel" || data.type !== "theme") return null;
  return data.mode === "light" || data.mode === "dark" ? data.mode : null;
}
