import { z } from "zod";

import { guard } from "@/lib/auth/server";
import { parseJsonBody, validationResponse } from "@/lib/validation";
import { volundFor } from "@/lib/volund/agents";
import { agentChannelResponse } from "@/lib/volund/channel-http";

/**
 * A decisão de uma aprovação que pausou o agente.
 *
 *   POST /api/volund/approvals/{id}/decide
 *   { "decisao": "aprovar" | "recusar", "motivo"?: "..." }
 *
 * O `id` é o `request_id` do evento `awaiting_input` com `kind: "approval"`.
 *
 * ## Por que isto existe como rota, e não como chamada da tela
 *
 * Pelo mesmo motivo do stream: quem autoriza a decisão é o token da troca, que
 * não pode chegar ao navegador. E vale reparar em quem decide de verdade — a
 * plataforma confere que a aprovação é de uma conversa desta pessoa. Uma pessoa
 * não aprova a ferramenta que o agente de outra pediu, e não é este arquivo que
 * garante isso.
 */

export const dynamic = "force-dynamic";

const corpo = z.object({
  decisao: z.enum(["aprovar", "recusar"]),
  /** Usado só na recusa — é o que o agente lê para decidir o que fazer no lugar. */
  motivo: z.string().max(500).optional(),
});

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const gate = await guard();
  if (!gate.ok) return gate.response;

  const parsed = await parseJsonBody(request, corpo);
  if (!parsed.ok) return validationResponse(parsed);

  try {
    const volund = await volundFor(gate.session);
    await volund.approvals.decide(
      id,
      parsed.data.decisao === "aprovar" ? "approve" : "reject",
      { note: parsed.data.motivo, signal: request.signal },
    );
    return Response.json({ ok: true });
  } catch (err) {
    return agentChannelResponse(err);
  }
}
