import { guard } from "@/lib/auth/server";
import { listAppAgents } from "@/lib/volund/agents";
import { agentChannelResponse } from "@/lib/volund/channel-http";

/**
 * O roteiro de agentes que este App oferece.
 *
 *   GET /api/volund/agents  →  { agentes: [{ key, name, description, avatar, isDefault }] }
 *
 * ## Por que a tela não fala direto com a plataforma
 *
 * Porque a credencial que a plataforma aceita é obtida com o **segredo deste
 * App**, e ela autoriza disparar agentes. Entregá-la ao navegador entregaria
 * essa autorização a quem abrisse o inspetor. Esta rota é a fronteira: o
 * segredo e o token ficam do lado de cá, e para cá vem só o que a tela precisa
 * desenhar.
 *
 * ## O identificador do agente não sai daqui
 *
 * A resposta traz o **apelido**, não o identificador. Se ele viajasse, uma tela
 * poderia mandar o identificador de qualquer agente da organização, e a oferta
 * do App deixaria de ser oferta para virar sugestão. Quem resolve apelido →
 * identificador é o servidor, no momento de chamar (`resolveAgentId`).
 *
 * `force-dynamic` porque a resposta depende de quem pediu — e porque o roteiro
 * muda sem republicação, que é justamente o que ele existe para permitir.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await guard();
  if (!gate.ok) return gate.response;

  try {
    const agentes = await listAppAgents(gate.session);
    return Response.json({ agentes });
  } catch (err) {
    return agentChannelResponse(err);
  }
}
