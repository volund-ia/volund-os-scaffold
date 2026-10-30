/**
 * As mensagens entre o App e o quadro do chat embutido (contrato 9).
 *
 * Os nomes são os da plataforma (`lib/embed/parent-messages.ts` e
 * docs/chat-embutido.md, "Eventos para a aplicação", no volund-os) e estão
 * espelhados em `contracts/agent-channel.json`, bloco `embedSession.messages`.
 * Renomear um aqui faz o App simplesmente parar de ouvir — sem erro e sem log.
 *
 * Sem import nenhum: é lido pelo componente de cliente e pelo teste.
 */

/** O que o quadro manda para o App. */
export const EMBED_EVENTS = [
  "volund:ready",
  "volund:thread-created",
  "volund:turn-started",
  "volund:turn-ended",
  "volund:artifact",
  "volund:session-expiring",
  "volund:error",
] as const;

export type EmbedEventType = (typeof EMBED_EVENTS)[number];

export interface EmbedEvent {
  type: EmbedEventType;
  /** O resto da mensagem, como veio. `thread_id` em `ready`/`thread-created`. */
  data: Record<string, unknown>;
}

/** O que o App manda para o quadro. */
export type EmbedCommand =
  | { type: "volund:set-color-mode"; mode: "light" | "dark" | "system" }
  | { type: "volund:send"; text: string }
  | { type: "volund:new-thread" };

/**
 * A mensagem do quadro, conferida — ou `null`.
 *
 * Origem exata do VolundOS E a janela do PRÓPRIO quadro: sem a segunda
 * conferência, qualquer outro quadro da plataforma aberto na página (ou o
 * painel que emoldura o App) poderia se passar pelo chat — e um
 * `session-expiring` falso faria o App criar sessões à toa.
 */
export function readEmbedEvent(
  event: { origin: string; source: unknown; data: unknown },
  platformOrigin: string,
  frameWindow: unknown,
): EmbedEvent | null {
  if (event.origin !== platformOrigin) return null;
  if (!frameWindow || event.source !== frameWindow) return null;
  const data = event.data;
  if (!data || typeof data !== "object") return null;
  const type = (data as { type?: unknown }).type;
  if (typeof type !== "string") return null;
  if (!(EMBED_EVENTS as readonly string[]).includes(type)) return null;
  return { type: type as EmbedEventType, data: data as Record<string, unknown> };
}

/** O `thread_id` que a mensagem traz, se for um. */
export function threadIdOf(event: EmbedEvent): string | null {
  const id = event.data.thread_id;
  return typeof id === "string" && id.length > 0 ? id : null;
}
