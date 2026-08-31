import { z } from "zod";

import { guard } from "@/lib/auth/server";
import { parseJsonBody, validationResponse } from "@/lib/validation";
import { volundFor } from "@/lib/volund/agents";
import { agentChannelResponse } from "@/lib/volund/channel-http";

/**
 * A resposta ao card de pergunta que o agente abriu.
 *
 *   POST /api/volund/questions/answer
 *   { "perguntaId": "...", "respostas": { "<pergunta>": "<opção>" } }
 *   { "perguntaId": "...", "pular": true }
 *
 * O `perguntaId` é o `request_id` do evento `question_asked`.
 *
 * ## Responder e pular são as duas saídas, e as duas existem
 *
 * Sem "pular", quem não quisesse escolher simplesmente fecharia o card — e o
 * agente ficaria esperando até desistir sozinho, em torno de dez minutos, com a
 * tela parada. Pular avisa na hora: ele segue com a melhor decisão possível e
 * declara a premissa que assumiu.
 *
 * ## As chaves são as perguntas, não índices
 *
 * `respostas` é um mapa do TEXTO da pergunta para o TEXTO da opção, exatamente
 * como vieram no evento. É assim que o agente as recebe de volta — um índice
 * numérico se desalinharia em silêncio se o card mudasse de ordem.
 */

export const dynamic = "force-dynamic";

const corpo = z.union([
  z.object({
    perguntaId: z.string().min(1).max(200),
    respostas: z.record(z.string(), z.string()),
    pular: z.literal(false).optional(),
  }),
  z.object({
    perguntaId: z.string().min(1).max(200),
    pular: z.literal(true),
  }),
]);

export async function POST(request: Request) {
  const gate = await guard();
  if (!gate.ok) return gate.response;

  const parsed = await parseJsonBody(request, corpo);
  if (!parsed.ok) return validationResponse(parsed);

  try {
    const volund = await volundFor(gate.session);
    // A pergunta é pelo campo que vai ser USADO, e não pela bandeira que
    // escolhe o ramo: assim o TypeScript estreita o union sozinho e o `as` some.
    // Um `as` aqui não validaria nada — só calaria o compilador sobre o campo
    // que o schema já garante.
    if ("respostas" in parsed.data) {
      await volund.questions.answer(parsed.data.perguntaId, parsed.data.respostas, {
        signal: request.signal,
      });
    } else {
      await volund.questions.skip(parsed.data.perguntaId, { signal: request.signal });
    }
    return Response.json({ ok: true });
  } catch (err) {
    return agentChannelResponse(err);
  }
}
