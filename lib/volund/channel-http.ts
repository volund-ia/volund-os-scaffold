/**
 * A tradução de falha do canal de agentes para HTTP, em UM lugar.
 *
 * As quatro rotas de `app/api/volund/` erram pelos mesmos motivos, e uma cópia
 * por rota divergiria — a que esquecesse de separar "este app não oferece agente
 * nenhum" de "não consegui falar com a plataforma" mostraria "algo deu errado"
 * para quem só precisava vincular um agente no painel.
 */

import { AgentChannelError } from "./agents";

/**
 * Translates agent-channel failures into HTTP responses.
 *
 * @param err - The failure raised by the agent channel
 * @returns A JSON response with the agent-channel error and an HTTP 409 or 503 status
 */
export function agentChannelResponse(err: unknown): Response {
  if (err instanceof AgentChannelError) {
    return Response.json(
      { error: err.code, message: err.message },
      { status: err.code === "sem_agente" ? 409 : 503 },
    );
  }
  console.error("[volund] falha inesperada no canal de agentes:", err);
  return Response.json(
    {
      error: "indisponivel",
      message:
        "Não consegui falar com o VolundOS agora. Tente de novo em alguns instantes.",
    },
    { status: 503 },
  );
}
