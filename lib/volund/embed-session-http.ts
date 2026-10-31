/**
 * O miolo de `POST /api/volund/embed-session`, fora do arquivo da rota.
 *
 * A rota só confere a sessão (`guard`, que lê o cookie do Next) e entrega a
 * pessoa aqui. O resto — o `content-type`, o corpo, criar a nova e encerrar a
 * anterior — depende só da `Request` e da sessão, e por isso roda num teste sem
 * servidor (`tests/volund-embed-sessao.test.ts`). Um arquivo de rota não pode
 * exportar nada além dos verbos, então o miolo mora aqui.
 */

import { z } from "zod";

import type { AuthConfig } from "@/lib/auth/config";
import type { Session } from "@/lib/auth/session";
import { parseJsonBody, validationResponse } from "@/lib/validation";

import { agentChannelResponse } from "./channel-http";
import {
  createEmbedSession,
  embedSessionOptionsSchema,
  revokeEmbedSession,
} from "./embed";

const corpo = embedSessionOptionsSchema
  .pick({ agent: true, threadId: true, colorMode: true })
  .extend({ replaces: z.string().min(1).max(200).optional() });

/**
 * A resposta do pedido de sessão nova, para quem já passou pelo `guard`.
 *
 * `config` só é passado pelo teste; na rota vale o do ambiente.
 */
export async function embedSessionPost(
  request: Request,
  session: Session,
  config?: AuthConfig,
): Promise<Response> {
  // Sem `application/json`, um formulário de outro site (que o navegador manda
  // sem pré-verificação) chegaria aqui com o cookie de quem o abriu.
  const tipo = request.headers.get("content-type") ?? "";
  if (!tipo.toLowerCase().startsWith("application/json")) {
    return Response.json(
      { error: "Envie o corpo como application/json.", issues: [] },
      { status: 415 },
    );
  }

  const parsed = await parseJsonBody(request, corpo);
  if (!parsed.ok) return validationResponse(parsed);
  const { replaces, ...opts } = parsed.data;

  try {
    const nova = await createEmbedSession(session, opts, config);
    // Limpeza, e não condição: se falhar, a antiga vence sozinha no fim do prazo.
    if (replaces && replaces !== nova.sessionId) {
      await revokeEmbedSession(session, replaces, config);
    }
    return Response.json(nova, {
      status: 201,
      headers: { "cache-control": "no-store" },
    });
  } catch (err) {
    return agentChannelResponse(err);
  }
}
