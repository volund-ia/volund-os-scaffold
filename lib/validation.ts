import { z } from "zod";

/**
 * Fronteira de entrada das rotas de API.
 *
 * Toda rota que recebe corpo ou query valida ANTES de usar: sem isso o dado do
 * cliente chega tipado como `unknown` e alguém "resolve" com um cast, que é
 * mentira em tempo de execução — o payload continua sendo o que o cliente
 * quis mandar.
 *
 * As duas funções devolvem um resultado em vez de lançar, porque a rota precisa
 * responder 400 com uma mensagem útil, não 500 com stack.
 */

export type ParseResult<T> =
  { ok: true; data: T } | { ok: false; status: 400; error: string; issues: string[] };

function fail(error: z.ZodError): ParseResult<never> {
  return {
    ok: false,
    status: 400,
    error: "Dados inválidos.",
    // Caminho + mensagem por campo: é o que permite ao cliente corrigir.
    issues: error.issues.map((i) =>
      i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message,
    ),
  };
}

/** Valida o corpo JSON de uma Request. Corpo ausente ou malformado vira 400. */
export async function parseJsonBody<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<ParseResult<z.infer<T>>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return {
      ok: false,
      status: 400,
      error: "Corpo da requisição não é um JSON válido.",
      issues: [],
    };
  }
  const parsed = schema.safeParse(raw);
  return parsed.success ? { ok: true, data: parsed.data } : fail(parsed.error);
}

/** Valida os parâmetros de query de uma URL. */
export function parseSearchParams<T extends z.ZodType>(
  url: string,
  schema: T,
): ParseResult<z.infer<T>> {
  const params = Object.fromEntries(new URL(url).searchParams.entries());
  const parsed = schema.safeParse(params);
  return parsed.success ? { ok: true, data: parsed.data } : fail(parsed.error);
}

/** Resposta padrão de erro de validação — mesma forma em toda a aplicação. */
export function validationResponse(result: Extract<ParseResult<never>, { ok: false }>) {
  return Response.json(
    { error: result.error, issues: result.issues },
    { status: result.status },
  );
}
