/**
 * As regras do seletor de elemento que não dependem de janela nem do React
 * (contrato 10). O componente (`components/volund/element-picker.tsx`) e o
 * seletor (`lib/volund/element-picker.ts`) passam por aqui, e é aqui que o teste
 * confere.
 *
 * O formato das mensagens está em `contracts/frame-protocol.json`, igual nas
 * duas pontas.
 */

/** Quem assina cada direção. */
export const FRAME_SOURCE_APP = "volund-app";
export const FRAME_SOURCE_PANEL = "volund-panel";

/** O aviso de que o seletor está pronto: sem ele, o painel deixa o botão desligado. */
export const PICK_READY_MESSAGE = {
  source: FRAME_SOURCE_APP,
  type: "pick-ready",
} as const;

/**
 * O pedido do painel para ligar ou desligar o modo seleção, ou `null` quando a
 * mensagem não é um, ou não veio da origem EXATA do painel e da janela pai.
 *
 * As duas conferências são do EVENTO, não do corpo: quem manda a mensagem
 * controla cada byte do corpo, mas não controla a origem nem qual janela falou.
 * Uma página qualquer que emoldurasse esta aplicação não liga o seletor.
 */
export function readPanelPickMessage(
  event: { origin: string; source: unknown; data: unknown },
  parentOrigin: string | null,
  parentWindow: unknown,
): boolean | null {
  if (!parentOrigin) return null;
  if (event.origin !== parentOrigin) return null;
  if (event.source !== parentWindow) return null;
  const data = event.data as {
    source?: unknown;
    type?: unknown;
    active?: unknown;
  } | null;
  if (!data || typeof data !== "object") return null;
  if (data.source !== FRAME_SOURCE_PANEL || data.type !== "pick") return null;
  return typeof data.active === "boolean" ? data.active : null;
}
