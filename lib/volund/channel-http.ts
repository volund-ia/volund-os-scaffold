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
 * `409`, e não `500`, para `sem_agente`.
 *
 * Não é falha do servidor: é o App num estado legítimo que ainda não foi
 * configurado. O `5xx` mandaria a tela dizer "tente de novo", e tentar de novo é
 * exatamente o que não resolve — o que resolve é alguém vincular um agente.
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
