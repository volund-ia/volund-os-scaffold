import { z } from "zod";

import { guard } from "@/lib/auth/server";
import { agentChannelResponse } from "@/lib/volund/channel-http";
import {
  createEmbedSession,
  embedSessionOptionsSchema,
  revokeEmbedSession,
} from "@/lib/volund/embed";
import { parseJsonBody, validationResponse } from "@/lib/validation";

/**
 * Uma sessão NOVA do chat embutido, para a tela que já está aberta.
 *
 *   POST /api/volund/embed-session
 *   { agent?, threadId?, colorMode?, replaces? }
 *   →  201 { embedUrl, sessionId, expiresAt, threadId }
 *
 * ## Quando a tela chama
 *
 * A página `/agentes` cria a primeira sessão no servidor e já nasce com o
 * endereço do quadro. Esta rota existe para o que acontece DEPOIS: o quadro
 * avisa `volund:session-expiring` dois minutos antes do fim, e o
 * `AgentEmbed` pede aqui um endereço novo — com o `threadId` da conversa em
 * curso, para a pessoa continuar onde estava. E para o "Abrir de novo" depois
 * de um `volund:error`.
 *
 * O endereço tem código de uso único que vence em 120 segundos, então ele não
 * pode ser pedido antes nem guardado: a tela pede, usa e esquece.
 *
 * `replaces` encerra a sessão anterior depois de a nova existir — limpeza, e
 * não condição: se falhar, a antiga vence sozinha no fim do prazo.
 *
 * O corpo exige `content-type: application/json`. Sem isso, um formulário de
 * outro site (que o navegador manda sem pré-verificação) chegaria aqui com o
 * cookie de quem o abriu.
 */

export const dynamic = "force-dynamic";

const corpo = embedSessionOptionsSchema
  .pick({ agent: true, threadId: true, colorMode: true })
  .extend({ replaces: z.string().min(1).max(200).optional() });

export async function POST(request: Request) {
  const gate = await guard();
  if (!gate.ok) return gate.response;

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
    const nova = await createEmbedSession(gate.session, opts);
    if (replaces && replaces !== nova.sessionId) {
      await revokeEmbedSession(gate.session, replaces);
    }
    return Response.json(nova, {
      status: 201,
      headers: { "cache-control": "no-store" },
    });
  } catch (err) {
    return agentChannelResponse(err);
  }
}
