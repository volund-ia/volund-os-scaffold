/**
 * A porta HTTP dos serviços: traduzir pedido em entrada, e resultado em
 * resposta. **Nada mais.**
 *
 * ## Por que a tradução mora num lugar só
 *
 * `ServiceError` tem seis códigos, e cada um tem um status HTTP certo. Escrita
 * rota por rota, essa correspondência erra: uma rota devolve 400 onde outra
 * devolve 422, uma esquece o 409 e responde 500, e o cliente que fala com as
 * duas passa a precisar saber com qual está falando. Aqui a tabela existe uma
 * vez — e um código novo na taxonomia aparece como erro de tipo neste arquivo,
 * em vez de virar 500 silencioso em cada rota.
 *
 * ## O portão de baixo continua sendo o serviço
 *
 * Repare no que esta camada NÃO faz: ela não confere sessão nem permissão. Quem
 * decide é o serviço, e é o mesmo serviço que a tela e a tool chamam — três
 * portas, uma decisão. A rota só sabe que `unauthenticated` vira 401 e
 * `forbidden` vira 403.
 *
 * Isso não afrouxa nada: a requisição já passou pelo `proxy.ts`, que exige
 * sessão em toda rota não enumerada como pública, e o serviço confere de novo no
 * limite onde a identidade é usada. O que desaparece é a terceira checagem
 * escrita à mão — que é onde a divergência nasce.
 */

import { getSession } from "../auth/server";
import type { Session } from "../auth/session";
import type { AnyService, ServiceErrorCode, ServiceResult } from "../services/types";

/**
 * Cada modo de falhar e o seu status. `satisfies` amarra a tabela à taxonomia:
 * um código novo em `ServiceErrorCode` não compila até ganhar um status aqui.
 */
export const HTTP_STATUS_BY_ERROR_CODE = {
  unauthenticated: 401,
  // 403 e não 404: quem chegou aqui está autenticado, e esconder a existência do
  // recurso de quem já entrou no sistema só dificulta o diagnóstico.
  forbidden: 403,
  invalid_input: 400,
  not_found: 404,
  conflict: 409,
  internal: 500,
} as const satisfies Record<ServiceErrorCode, number>;

/**
 * Resultado do serviço em resposta HTTP.
 *
 * Sucesso devolve o dado direto, sem envelope: é o que os clientes deste App
 * consomem, e um `{ data: ... }` a mais só existiria para ser desembrulhado.
 * Falha devolve `error` (a mensagem em português, pronta para a tela), `codigo`
 * (para o cliente decidir sem interpretar texto) e, quando existem, `permissao`
 * e `detalhes`.
 *
 * `cache-control: no-store` em tudo: a resposta depende de quem pediu.
 */
export function serviceResponse(result: ServiceResult<unknown>): Response {
  const headers = { "cache-control": "no-store" };

  if (result.ok) {
    return Response.json(result.data, { status: 200, headers });
  }

  const { code, message, permission, issues } = result.error;
  return Response.json(
    {
      error: message,
      codigo: code,
      ...(permission ? { permissao: permission } : {}),
      ...(issues?.length ? { detalhes: issues } : {}),
    },
    { status: HTTP_STATUS_BY_ERROR_CODE[code], headers },
  );
}

export interface ServiceRouteOptions {
  /**
   * De onde vem a entrada do serviço: do corpo JSON (`POST`/`PUT`/`PATCH`) ou
   * dos parâmetros de query (`GET`).
   *
   * **Com `"query"`, dois limites que o schema do serviço não corrige sozinho:**
   *
   * 1. **Todo valor chega como texto.** Um serviço com `z.number()` na entrada
   *    responde 400 mesmo com a query certa. Use `z.coerce.number()` (ou
   *    equivalente) no schema do próprio serviço.
   * 2. **Chave repetida fica só com o último valor.** `?tag=a&tag=b` chega como
   *    `{ tag: "b" }`, então um serviço que espera lista nunca a recebe. Se a
   *    rota precisa de lista, escreva o handler à mão — leia `getAll()` e chame
   *    o serviço com o array pronto.
   *
   * Os dois são seguros (a recusa é explícita, não silenciosa); o problema é de
   * descoberta, e por isso estão escritos aqui e exercitados em teste.
   */
  from: "json" | "query";
  /**
   * Como a sessão é lida. O default é o `getSession()` da aplicação; o parâmetro
   * existe para que a rota seja exercitável em teste — `getSession()` depende do
   * contexto de requisição do Next e não funciona fora dele, e uma rota que não
   * dá para testar é uma rota cuja tradução ninguém confere.
   *
   * É a mesma técnica que `lib/auth/session.ts` já usa para o `fetch` do
   * provedor nos testes de sessão.
   */
  readSession?: () => Promise<Session | null>;
}

/**
 * Rota de API sobre um serviço.
 *
 * ```ts
 * // app/api/avisos/route.ts
 * export const dynamic = "force-dynamic";
 * export const POST = serviceRoute(publicarAviso, { from: "json" });
 * ```
 *
 * O schema de entrada é o do serviço — não há um segundo schema aqui para
 * divergir do primeiro. O que a rota resolve é o que só ela pode: corpo que não
 * é JSON, e parâmetros de query, que chegam sempre como texto.
 *
 * Precisa de algo que não caiba aqui (parâmetro de caminho, cabeçalho,
 * upload)? Escreva o handler à mão e devolva `serviceResponse(resultado)` — a
 * tradução continua sendo uma só.
 */
export function serviceRoute(
  service: AnyService,
  options: ServiceRouteOptions,
): (request: Request) => Promise<Response> {
  const lerSessao = options.readSession ?? getSession;

  return async function handler(request: Request): Promise<Response> {
    let input: unknown;

    if (options.from === "json") {
      try {
        input = await request.json();
      } catch {
        // O serviço valida a FORMA da entrada; corpo que não é JSON nem chega a
        // ser uma entrada, e a mensagem precisa dizer isso — "dados inválidos"
        // mandaria quem chamou procurar o campo errado.
        return Response.json(
          {
            error: "Corpo da requisição não é um JSON válido.",
            codigo: "invalid_input",
          },
          { status: 400, headers: { "cache-control": "no-store" } },
        );
      }
    } else {
      input = Object.fromEntries(new URL(request.url).searchParams.entries());
    }

    const session = await lerSessao();
    return serviceResponse(await service.execute(session, input));
  };
}
