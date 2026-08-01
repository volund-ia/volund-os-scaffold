import {
  HANDSHAKE_COOKIE,
  MissingAuthEnvError,
  readAuthConfig,
  type AuthConfig,
} from "@/lib/auth/config";
import {
  clearedCookie,
  exchangeCode,
  readHandshake,
  safeReturnTo,
  sealSession,
  sessionCookie,
} from "@/lib/auth/session";

/**
 * `GET /api/auth/callback` — retorno do provedor, onde a sessão nasce.
 *
 * **Rota pública por enumeração** (`lib/auth/route-policy.ts`), e é o caso que
 * torna a allow-list necessária: ela é chamada ANTES de existir sessão. Exigir
 * sessão aqui faria o login nunca terminar — o provedor devolveria o usuário e o
 * proxy o mandaria de volta para o login, em círculo.
 *
 * O caminho é fixo por contrato: a plataforma registra o `redirect_uri` de cada
 * endereço conhecido do App terminando exatamente nele, e a conferência do outro
 * lado é por igualdade exata (RFC 9700).
 */
export const dynamic = "force-dynamic";

/** Lê um cookie do cabeçalho cru — sem `next/headers`, para poder ser testado. */
function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

function failure(request: Request, motivo: string, status = 400): Response {
  return Response.json(
    { error: "não foi possível concluir o login", motivo },
    {
      status,
      headers: {
        // O aperto de mão desta tentativa não serve mais, tenha ela dado certo
        // ou não. Deixá-lo vivo daria uma segunda chance a quem estivesse
        // testando `state` no chute.
        "set-cookie": clearedCookie(HANDSHAKE_COOKIE, request.url),
        "cache-control": "no-store",
      },
    },
  );
}

export async function GET(request: Request) {
  let config: AuthConfig;
  try {
    config = readAuthConfig();
  } catch (err) {
    if (err instanceof MissingAuthEnvError) {
      console.error(`[auth] configuração ausente: ${err.variable}`);
      return Response.json(
        { error: "autenticação não configurada", variavel: err.variable },
        { status: 503, headers: { "cache-control": "no-store" } },
      );
    }
    console.error("[auth] falha ao ler a configuração:", err);
    return Response.json({ error: "autenticação indisponível" }, { status: 500 });
  }

  const url = new URL(request.url);

  // O provedor recusou (usuário cancelou, client sem acesso, escopo inválido).
  // A descrição dele vai para o log; a resposta não a repete de volta ao
  // navegador — é texto de terceiro renderizado numa página nossa.
  const providerError = url.searchParams.get("error");
  if (providerError) {
    console.error(
      `[auth] provedor recusou a autorização: ${providerError} ${url.searchParams.get("error_description") ?? ""}`,
    );
    return failure(request, "o provedor de identidade recusou a autorização", 403);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return failure(request, "resposta do provedor incompleta");

  const handshake = await readHandshake(readCookie(request, HANDSHAKE_COOKIE), config);
  if (!handshake) {
    // Cookie ausente, expirado ou selado com outra chave. É também o que
    // acontece quando alguém chama este endereço direto, sem ter passado pelo
    // `/api/auth/login` — e a recusa é a resposta certa nos dois casos.
    return failure(request, "pedido de login não encontrado ou expirado");
  }

  // O `state` é o que amarra esta resposta ao pedido que este navegador
  // iniciou. Sem a conferência, um código obtido em outro contexto poderia ser
  // entregue aqui e viraria sessão (CSRF de login).
  if (handshake.state !== state) return failure(request, "pedido de login não confere");

  try {
    const payload = await exchangeCode({ config, code, handshake });
    const destino = safeReturnTo(handshake.returnTo);

    const headers = new Headers({ location: destino, "cache-control": "no-store" });
    headers.append(
      "set-cookie",
      sessionCookie(await sealSession(payload, config), request.url),
    );
    headers.append("set-cookie", clearedCookie(HANDSHAKE_COOKIE, request.url));

    return new Response(null, { status: 302, headers });
  } catch (err) {
    // Código já usado, `code_verifier` divergente, client sem credencial válida,
    // ID token recusado. Todos viram a mesma resposta: distinguir aqui contaria
    // a quem tentou qual parte da tentativa falhou.
    console.error("[auth] troca de código falhou:", err);
    return failure(request, "não foi possível concluir o login");
  }
}
