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

/**
 * Um corpo diz UMA coisa: ou as respostas, ou o pedido de pular.
 *
 * ## Por que não é um `union` de dois objetos
 *
 * Era, e o `union` aceitava calado um corpo que dizia as duas. `z.object`
 * DESCARTA chave desconhecida por padrão: `{ perguntaId, respostas, pular: true }`
 * é recusado pelo primeiro membro (que exige `pular` ausente ou `false`), cai no
 * segundo — e o segundo não conhece `respostas`, então ela é **removida**. O que
 * chegava ao outro lado era um "pular" limpo, e as escolhas da pessoa sumiam sem
 * uma palavra. Medido: `safeParse` devolve `success: true` com
 * `{"perguntaId":"p1","pular":true}`.
 *
 * Um objeto só com a exclusividade declarada recusa esse corpo em vez de
 * escolher por conta própria qual das duas intenções valia. A mensagem diz o que
 * fazer, porque "dados inválidos" sobre um corpo que parece completo é o tipo de
 * erro que se investiga no lugar errado.
 */
export const corpoDaResposta = z
  .object({
    perguntaId: z.string().min(1).max(200),
    respostas: z.record(z.string(), z.string()).optional(),
    pular: z.boolean().optional(),
  })
  .refine((v) => (v.pular === true) !== (v.respostas !== undefined), {
    message:
      "Informe `respostas` OU `pular: true` — nunca os dois juntos, nunca nenhum dos dois.",
  });

export async function POST(request: Request) {
  const gate = await guard();
  if (!gate.ok) return gate.response;

  const parsed = await parseJsonBody(request, corpoDaResposta);
  if (!parsed.ok) return validationResponse(parsed);

  try {
    const volund = await volundFor(gate.session);
    // A pergunta é pelo campo que vai ser USADO, e não pela bandeira. Com a
    // exclusividade garantida pelo schema, `respostas` presente significa
    // responder, e ausente significa pular — sem `as` e sem terceira
    // possibilidade.
    const { perguntaId, respostas } = parsed.data;
    if (respostas) {
      await volund.questions.answer(perguntaId, respostas, { signal: request.signal });
    } else {
      await volund.questions.skip(perguntaId, { signal: request.signal });
    }
    return Response.json({ ok: true });
  } catch (err) {
    return agentChannelResponse(err);
  }
}
