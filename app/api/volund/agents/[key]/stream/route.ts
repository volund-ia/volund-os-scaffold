import type { VolundEvent } from "@volund-ia/sdk";
import { z } from "zod";

import { guard } from "@/lib/auth/server";
import { parseJsonBody, validationResponse } from "@/lib/validation";
import { resolveAgentId, volundFor } from "@/lib/volund/agents";
import { agentChannelResponse } from "@/lib/volund/channel-http";

/**
 * A conversa com um agente do App, em streaming.
 *
 *   POST /api/volund/agents/{apelido}/stream
 *   { "input": "...", "conversaId"?: "..." }
 *   →  text/event-stream de VolundEvent
 *
 * Sem `conversaId`, começa uma conversa nova; com ele, continua a que existe. O
 * identificador da conversa chega ao cliente no primeiro evento (`run_started`),
 * e é ele que volta aqui na mensagem seguinte.
 *
 * ## Quem é a pessoa, do outro lado
 *
 * É quem está usando a aplicação — não este App, não o dono de uma chave. O
 * token que autentica a chamada nasce da sessão dela (troca RFC 8693, em
 * `lib/volund/agents.ts`) e diz "esta pessoa, através deste App". A conversa
 * nasce dela, o consumo é dela, e o histórico no VolundOS conta isso.
 *
 * A consequência que vale saber: continuar uma conversa que é de OUTRA pessoa
 * não é recusado por código nosso — a plataforma responde "não encontrado",
 * porque com a identidade dela aquela conversa não existe. É o mesmo portão que
 * protege o resto, e não uma checagem que este arquivo poderia esquecer.
 *
 * ## `channel_error` não é `run_finished`
 *
 * Quando a falha é do CANAL — a conexão com a plataforma caiu no meio —, o
 * evento emitido é `{"type":"channel_error"}`, que não pertence ao contrato de
 * eventos do agente. Traduzi-lo para `run_finished status:"failed"` diria que o
 * agente falhou, e ele pode muito bem ter terminado bem do outro lado. São
 * coisas diferentes e a tela precisa poder dizer coisas diferentes.
 */

export const dynamic = "force-dynamic";

/**
 * Um turno de agente dura o tempo de ele pensar e usar ferramentas — minutos,
 * não segundos. O teto default de função serverless mataria a conexão no meio,
 * e o sintoma seria a resposta parando na metade sem erro nenhum.
 */
export const maxDuration = 800;

const corpo = z.object({
  input: z.string().min(1, "Escreva alguma coisa.").max(20_000),
  /**
   * A conversa a continuar. Ausente, começa uma nova.
   *
   * Chega do cliente e é usado como veio, de propósito: quem decide se esta
   * pessoa pode continuar aquela conversa é a plataforma, com a identidade
   * dela. Uma lista de conversas guardada aqui seria uma segunda autorização,
   * que divergiria da primeira.
   */
  conversaId: z.string().min(1).max(200).optional(),
});

/** Intervalo do batimento que mantém a conexão viva durante um silêncio longo. */
const PING_MS = 15_000;

export async function POST(
  request: Request,
  ctx: { params: Promise<{ key: string }> },
) {
  const { key } = await ctx.params;

  const gate = await guard();
  if (!gate.ok) return gate.response;

  const parsed = await parseJsonBody(request, corpo);
  if (!parsed.ok) return validationResponse(parsed);

  try {
    // Resolvido mesmo na continuação: o apelido faz parte do endereço, e um
    // endereço que aponta para um agente que o App não oferece deve responder
    // "não existe" — independentemente de a conversa existir.
    const { agentId } = await resolveAgentId(gate.session, key);
    const volund = await volundFor(gate.session);

    const run = parsed.data.conversaId
      ? await volund.agents.continue({
          runId: parsed.data.conversaId,
          input: parsed.data.input,
          signal: request.signal,
        })
      : await volund.agents.run({
          agentId,
          input: parsed.data.input,
          signal: request.signal,
        });

    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let aberto = true;
        /** Escreve um quadro SSE, se ainda houver alguém do outro lado. */
        const enviar = (
          payload: VolundEvent | { type: "channel_error"; message: string },
        ) => {
          if (!aberto) return;
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
          } catch {
            // O consumidor foi embora entre a checagem e o envio. Não é erro:
            // `cancel` já cuidou de encerrar o run.
            aberto = false;
          }
        };

        // Um comentário SSE a cada 15s. Ele não chega ao cliente como evento —
        // serve para que um intermediário (proxy, balanceador) não conclua que a
        // conexão morreu enquanto o agente usa uma ferramenta demorada.
        const batimento = setInterval(() => {
          if (!aberto) return;
          try {
            controller.enqueue(encoder.encode(": ping\n\n"));
          } catch {
            aberto = false;
          }
        }, PING_MS);

        try {
          for await (const event of run.stream()) enviar(event);
        } catch (err) {
          console.error("[volund] stream do agente interrompido:", err);
          enviar({
            type: "channel_error",
            message: "A conexão com o VolundOS caiu no meio da resposta.",
          });
        } finally {
          clearInterval(batimento);
          if (aberto) {
            aberto = false;
            try {
              controller.close();
            } catch {
              // Já fechado pelo cancelamento do consumidor.
            }
          }
        }
      },
      cancel() {
        // A pessoa fechou a aba ou trocou de tela. Cancelar avisa a plataforma,
        // que derruba o ambiente do agente — sem isto ele seguiria trabalhando
        // para ninguém, consumindo o que é dela.
        run.cancel();
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        // `no-transform` além do `no-store`: um proxy que "otimize" a resposta
        // pode juntar os pedaços, e um stream que chega inteiro no fim deixa de
        // ser um stream.
        "cache-control": "no-store, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    });
  } catch (err) {
    return agentChannelResponse(err);
  }
}
