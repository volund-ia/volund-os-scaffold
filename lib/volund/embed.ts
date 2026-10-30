/**
 * A sessão do chat embutido do VolundOS em modo PESSOA (contrato 9).
 *
 * ## Por que o App não tem mais chat próprio
 *
 * Até o contrato 8 o scaffold trazia uma tela de conversa inteira — markdown,
 * anexos, aprovação, pergunta, bloco de ferramenta — reimplementando o que o
 * chat do VolundOS já faz. Cada recurso novo do chat da plataforma era uma
 * divergência nova em cada App. No 9 a conversa É o chat do VolundOS, num
 * quadro: o App cria a sessão no servidor e mostra o `embed_url`.
 *
 * ## Em nome de quem
 *
 * Da pessoa que está usando o App, como no contrato 8: o servidor troca o token
 * da sessão (`exchangeForPlatformToken`, RFC 8693) e cria a sessão do chat com
 * ele. A conversa nasce dela, o consumo é dela, e o histórico diz que foi ela.
 *
 * ## O que chega ao navegador
 *
 * Só o `embed_url`: o endereço do quadro com um código de USO ÚNICO no
 * fragmento (`#code=`), que vence em 120 segundos. O token trocado continua
 * deste lado. Por isso a sessão é criada a cada abertura da tela (a página é
 * `force-dynamic`), e não guardada: um endereço guardado já teria o código
 * gasto ou vencido.
 *
 * O formato do pedido e da resposta está em `contracts/agent-channel.json`,
 * bloco `embedSession`; `tests/volund-embed-sessao.test.ts` confere um contra o
 * outro.
 */

import { z } from "zod";

import { readAuthConfig, type AuthConfig } from "@/lib/auth/config";
import type { Session } from "@/lib/auth/session";

import { AgentChannelError, exchangeForPlatformToken } from "./agents";

/** O caminho da sessão na plataforma. Espelhado em `contracts/agent-channel.json`. */
export const EMBED_SESSIONS_PATH = "/api/v1/apps/me/embed-sessions";

/** A vida da sessão aceita pela plataforma, em segundos. */
export const EMBED_TTL_MIN_SECONDS = 300;
export const EMBED_TTL_MAX_SECONDS = 28_800;

/** Mesmo teto das outras chamadas ao provedor (`lib/volund/agents.ts`). */
const PROVIDER_TIMEOUT_MS = 5_000;

const INDISPONIVEL =
  "Não consegui abrir a conversa agora. Tente de novo em alguns instantes.";

/**
 * O que o App pode pedir. É também o schema do corpo de
 * `POST /api/volund/embed-session`: a tela pede pela mesma forma, e o que ela
 * não pode escolher simplesmente não está aqui.
 */
export const embedSessionOptionsSchema = z.object({
  /** O APELIDO do agente; sem ele, o padrão do App. */
  agent: z.string().min(1).max(100).optional(),
  /** Retomar uma conversa. É o que mantém o histórico quando a sessão é renovada. */
  threadId: z.uuid().optional(),
  colorMode: z.enum(["light", "dark", "system"]).optional(),
  locale: z.enum(["pt-BR", "en"]).optional(),
  ttlSeconds: z
    .number()
    .int()
    .min(EMBED_TTL_MIN_SECONDS)
    .max(EMBED_TTL_MAX_SECONDS)
    .optional(),
});

export type EmbedSessionOptions = z.infer<typeof embedSessionOptionsSchema>;

export interface EmbedSession {
  sessionId: string;
  /** Absoluto, na origem do VolundOS. Com código de uso único: use uma vez. */
  embedUrl: string;
  expiresAt: string;
  threadId: string | null;
}

const responseSchema = z.object({
  session_id: z.string().min(1),
  embed_url: z.string().min(1),
  expires_at: z.string().min(1),
  thread_id: z.string().nullable().optional(),
});

/** O corpo do pedido, nos nomes da plataforma. Só o que foi pedido vai. */
export function embedSessionRequestBody(
  opts: EmbedSessionOptions,
): Record<string, string | number> {
  const body: Record<string, string | number> = {};
  if (opts.agent) body.agent = opts.agent;
  if (opts.threadId) body.thread_id = opts.threadId;
  if (opts.colorMode) body.color_mode = opts.colorMode;
  if (opts.locale) body.locale = opts.locale;
  if (opts.ttlSeconds !== undefined) body.ttl_seconds = opts.ttlSeconds;
  return body;
}

/**
 * Da recusa nomeada da plataforma para o motivo do canal.
 *
 * `agent_not_found` e `thread_not_found` são da tela (apelido errado num link,
 * conversa de outra pessoa) e merecem frase própria. `not_an_app_token` e
 * `invalid_request` são defeito deste lado — a pessoa não resolve nada — e vão
 * para o log com o genérico na tela.
 */
function errorFor(status: number, code: string | undefined): AgentChannelError {
  if (status === 404 && code === "agent_not_found") {
    return new AgentChannelError(
      "agente_desconhecido",
      "Este app não oferece esse assistente. Escolha outro da lista.",
    );
  }
  if (status === 404 && code === "thread_not_found") {
    return new AgentChannelError(
      "conversa_desconhecida",
      "Não encontrei essa conversa. Comece uma nova.",
    );
  }
  console.error(
    `[volund] sessão do chat embutido recusada: ${status} ${code ?? ""}`.trim(),
  );
  return new AgentChannelError("indisponivel", INDISPONIVEL);
}

/**
 * Cria a sessão do chat embutido em nome de quem está usando a aplicação.
 *
 * Lança `AgentChannelError`: `sem_agente` (o App não oferece nenhum agente —
 * vem da troca), `agente_desconhecido`, `conversa_desconhecida` ou
 * `indisponivel`.
 */
export async function createEmbedSession(
  session: Session,
  opts: EmbedSessionOptions = {},
  config: AuthConfig = readAuthConfig(),
): Promise<EmbedSession> {
  const token = await exchangeForPlatformToken(session, config);

  let response: Response;
  try {
    response = await fetch(new URL(EMBED_SESSIONS_PATH, config.issuer), {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(embedSessionRequestBody(opts)),
      // A resposta carrega um código de entrada de uso único: guardá-la em
      // qualquer camada entregaria a conversa de uma pessoa à próxima.
      cache: "no-store",
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
  } catch (err) {
    throw new AgentChannelError("indisponivel", INDISPONIVEL, { cause: err });
  }

  const data: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const code =
      data &&
      typeof data === "object" &&
      typeof (data as { error?: unknown }).error === "string"
        ? (data as { error: string }).error
        : undefined;
    throw errorFor(response.status, code);
  }

  const parsed = responseSchema.safeParse(data);
  if (!parsed.success) {
    console.error("[volund] sessão do chat embutido em formato inesperado");
    throw new AgentChannelError("indisponivel", INDISPONIVEL);
  }

  // O quadro só abre na origem do VolundOS. Um `embed_url` em outro host — por
  // defeito do outro lado ou por quem o tivesse comprometido — poria na tela de
  // quem usa o App uma página que se passa pela conversa.
  let embedUrl: URL;
  try {
    embedUrl = new URL(parsed.data.embed_url);
  } catch {
    console.error("[volund] sessão do chat embutido com endereço inválido");
    throw new AgentChannelError("indisponivel", INDISPONIVEL);
  }
  if (embedUrl.origin !== new URL(config.issuer).origin) {
    console.error(
      `[volund] sessão do chat embutido fora do emissor: ${embedUrl.origin}`,
    );
    throw new AgentChannelError("indisponivel", INDISPONIVEL);
  }

  return {
    sessionId: parsed.data.session_id,
    embedUrl: embedUrl.toString(),
    expiresAt: parsed.data.expires_at,
    threadId: parsed.data.thread_id ?? null,
  };
}

/**
 * Encerra uma sessão do chat embutido. Nunca lança: encerrar é limpeza, e a
 * sessão vence sozinha no fim do `ttl`.
 *
 * `true` quando a sessão não existe mais (204, ou 404 de quem já tinha saído).
 */
export async function revokeEmbedSession(
  session: Session,
  sessionId: string,
  config: AuthConfig = readAuthConfig(),
): Promise<boolean> {
  try {
    const token = await exchangeForPlatformToken(session, config);
    const response = await fetch(
      new URL(`${EMBED_SESSIONS_PATH}/${encodeURIComponent(sessionId)}`, config.issuer),
      {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}`, accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      },
    );
    if (response.status === 204 || response.status === 404) return true;
    console.error(
      `[volund] encerrar a sessão do chat embutido respondeu ${response.status}`,
    );
    return false;
  } catch (err) {
    console.error("[volund] não consegui encerrar a sessão do chat embutido:", err);
    return false;
  }
}
