import { createMcpHandler } from "mcp-handler";

import { can } from "@/lib/auth/permissions";
import { getSessionFromBearer } from "@/lib/auth/server";
import type { Session } from "@/lib/auth/session";
import { toolResultFromService } from "@/lib/mcp/result";
import { TOOLS } from "@/lib/mcp/tools";

/**
 * O endpoint MCP deste App: a porta pela qual um **agente** usa as capacidades
 * que a tela e a API já usam.
 *
 * Transporte Streamable HTTP pelo SDK oficial (`@modelcontextprotocol/sdk`) com o
 * adaptador `mcp-handler`, que faz a ponte para uma rota do App Router. O
 * protocolo evolui no SDK, não aqui.
 *
 * ## A identidade é a mesma da tela — não há identidade de MCP
 *
 * Quem chama apresenta `Authorization: Bearer <access token>`, e é **o mesmo
 * token** que o navegador da pessoa apresentaria: mesma verificação (emissor,
 * audiência `volund:app:<appAgentId>`, `azp`), mesmo mapeamento de claims, mesma
 * `Session`. Não existe chave por App, não existe conta de serviço, não existe
 * população de identidade paralela. Revogar o acesso de alguém revoga também o
 * MCP dele, porque não há um segundo lugar para lembrar de cortar.
 *
 * ## Esta rota é enumerada como pública em `lib/auth/route-policy.ts`
 *
 * "Pública" ali significa dispensada do portão de **cookie** — um agente não tem
 * cookie. O portão continua existindo e é este arquivo: sem token válido, 401
 * antes de qualquer tool ser montada. Um portão trocado por outro, não removido.
 *
 * ## Presença e execução saem do mesmo `can()`
 *
 * As tools que o sujeito não pode chamar são registradas e **desabilitadas**:
 * saem do `tools/list` e, se alguém chamar pelo nome de qualquer forma, o SDK
 * recusa. Não é só ergonomia — a lista completa entregaria o desenho interno do
 * App a quem não tem acesso a nada dele.
 *
 * E a checagem não acaba aí: a tool chama o serviço, e o serviço confere `can()`
 * de novo. Quem chama pelo nome nunca passou pela lista, então a lista não pode
 * ser a única guarda.
 *
 * `force-dynamic` porque a resposta depende de quem pediu.
 */
export const dynamic = "force-dynamic";

/**
 * 401 com `WWW-Authenticate`, que é o que diz ao cliente MCP **como** se
 * autenticar em vez de só que ele falhou.
 */
function naoAutenticado(): Response {
  return Response.json(
    { error: "não autenticado" },
    {
      status: 401,
      headers: {
        "www-authenticate": 'Bearer realm="volund", error="invalid_token"',
        "cache-control": "no-store",
      },
    },
  );
}

/** Monta o servidor MCP para ESTE sujeito. */
function handlerPara(session: Session) {
  return createMcpHandler(
    (server) => {
      for (const tool of Object.values(TOOLS)) {
        const registrada = server.registerTool(
          tool.name,
          {
            description: tool.description,
            inputSchema: tool.input,
            // O `kind` que o serviço declarou chega ao cliente como dica de
            // leitura/escrita. É o que permite a quem opera o agente decidir o
            // que passa direto e o que pede confirmação.
            annotations: { readOnlyHint: tool.kind === "read" },
          },
          // A tool não decide: chama o serviço e traduz. O `can()` que vale é o
          // de dentro dele.
          async (args: unknown) =>
            toolResultFromService(await tool.call(session, args)),
        );

        if (tool.permission !== null && !can(session, tool.permission)) {
          registrada.disable();
        }
      }
    },
    {
      serverInfo: { name: "volund-app", version: "1.0.0" },
    },
  );
}

export async function POST(request: Request): Promise<Response> {
  const session = await getSessionFromBearer(request);
  if (!session) return naoAutenticado();
  return handlerPara(session)(request);
}

/**
 * O cliente que tenta abrir o canal de eventos cai aqui. O servidor é **sem
 * estado** (cada chamada traz o próprio token e monta o próprio servidor), então
 * não há stream para manter — e é o SDK quem responde isso no formato do
 * protocolo. Sem este export, o Next devolveria um 405 em HTML, que o cliente
 * não sabe ler.
 */
export async function GET(request: Request): Promise<Response> {
  const session = await getSessionFromBearer(request);
  if (!session) return naoAutenticado();
  return handlerPara(session)(request);
}
