/**
 * Resultado de serviço → resultado de tool de MCP.
 *
 * A tradução mora aqui, num lugar só, pelo mesmo motivo de
 * `lib/http/service-route.ts`: os seis modos de falhar da camada de serviço têm
 * de chegar ao agente com o **mesmo significado** que chegam ao navegador. Duas
 * traduções escritas em lugares diferentes divergem — e aí o agente e a pessoa
 * recebem respostas diferentes para a mesma recusa, que é a divergência que esta
 * arquitetura existe para não ter.
 *
 * ## Por que o erro vai como resultado, e não como erro de protocolo
 *
 * No MCP há duas formas de dizer "não deu": o erro de JSON-RPC (o pedido não pôde
 * ser processado) e o resultado com `isError` (a ferramenta rodou e recusou).
 * Falta de permissão, entrada inválida e conflito de estado são a **segunda**: o
 * pedido foi entendido, a decisão foi tomada, e a resposta é para o agente ler e
 * agir — pedindo a permissão a quem administra, corrigindo o campo, desistindo.
 * Erro de protocolo tira a mensagem do fluxo da conversa e deixa o agente sem o
 * que fazer.
 *
 * ## O que NUNCA vai daqui para fora
 *
 * Detalhe de infraestrutura. A mensagem de `internal` já nasce genérica no
 * serviço (o host, a porta e a configuração do banco ficam no log do provedor), e
 * esta camada não acrescenta nada: ela repassa o que o serviço decidiu contar.
 */

import type { ServiceResult } from "../services/types";

/**
 * O que o SDK espera de uma tool: blocos de conteúdo, e a marca de erro.
 *
 * `type` e não `interface` de propósito: o tipo do SDK tem índice de string
 * (`[x: string]: unknown`), e o TypeScript só concede índice implícito a alias de
 * tipo — uma `interface` aqui não seria atribuível, e o erro apareceria longe,
 * como "falta resultType".
 */
export type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

const texto = (valor: string): ToolResult["content"] => [{ type: "text", text: valor }];

/**
 * Sucesso vira JSON legível; falha vira `isError` com a mensagem em português
 * mais o **código** da taxonomia.
 *
 * O código existe para o agente decidir sem interpretar texto: `forbidden` é
 * "peça acesso a quem administra", `invalid_input` é "corrija e tente de novo",
 * `internal` é "não insista". Sem ele, todo erro pareceria a mesma coisa e o
 * agente repetiria a chamada que nunca vai passar.
 */
export function toolResultFromService(resultado: ServiceResult<unknown>): ToolResult {
  if (resultado.ok) {
    return { content: texto(JSON.stringify(resultado.data, null, 2)) };
  }

  const { code, message, permission, issues } = resultado.error;
  const partes = [`${message} (código: ${code})`];

  if (permission) {
    // Dizer QUAL permissão falta é o que transforma a recusa em algo acionável:
    // o agente tem o nome exato para pedir a quem administra o App.
    partes.push(`Permissão exigida: ${permission}.`);
  }
  if (issues?.length) {
    partes.push(`Campos com problema: ${issues.join("; ")}.`);
  }

  return { content: texto(partes.join(" ")), isError: true };
}
