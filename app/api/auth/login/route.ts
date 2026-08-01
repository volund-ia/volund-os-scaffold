import {
  HANDSHAKE_COOKIE,
  HANDSHAKE_TTL_SECONDS,
  MissingAuthEnvError,
  readAuthConfig,
  type AuthConfig,
} from "@/lib/auth/config";
import { codeChallengeS256, randomToken } from "@/lib/auth/crypto";
import {
  buildAuthorizationUrl,
  callbackUriFor,
  handshakeCookie,
  safeReturnTo,
  sealHandshake,
  type Handshake,
} from "@/lib/auth/session";

/**
 * `GET /api/auth/login` — início do fluxo de autorização.
 *
 * **Rota pública por enumeração** (`lib/auth/route-policy.ts`): quem chega aqui
 * está, por definição, sem sessão.
 *
 * Sorteia `state`, `nonce` e o verificador do PKCE, guarda os três num cookie
 * selado de vida curta e manda o navegador para a página de autorização da
 * plataforma. Nada disto viaja em texto claro nem fica em memória do servidor —
 * o cookie é o que amarra o retorno a este pedido, e ele é o único estado.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  let config: AuthConfig;
  try {
    config = readAuthConfig();
  } catch (err) {
    if (err instanceof MissingAuthEnvError) {
      // Falha explícita nomeando a variável — nunca degradar para acesso aberto.
      // O nome da variável é o que o requisito pede e o que permite consertar; a
      // mensagem completa (que enumera as três e conta como o ambiente é
      // montado) fica no log, porque esta rota é pública.
      console.error(`[auth] configuração ausente: ${err.variable} — ${err.message}`);
      return Response.json(
        { error: "autenticação não configurada", variavel: err.variable },
        { status: 503, headers: { "cache-control": "no-store" } },
      );
    }
    console.error("[auth] falha ao ler a configuração:", err);
    return Response.json(
      { error: "autenticação indisponível" },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }

  const url = new URL(request.url);
  const codeVerifier = randomToken(64);

  const handshake: Handshake = {
    state: randomToken(),
    nonce: randomToken(),
    codeVerifier,
    redirectUri: callbackUriFor(request.url),
    returnTo: safeReturnTo(url.searchParams.get("returnTo")),
    expiresAt: Date.now() + HANDSHAKE_TTL_SECONDS * 1000,
  };

  try {
    const authorizationUrl = await buildAuthorizationUrl({
      config,
      handshake,
      codeChallenge: await codeChallengeS256(codeVerifier),
    });

    return new Response(null, {
      status: 302,
      headers: {
        location: authorizationUrl,
        "set-cookie": handshakeCookie(
          HANDSHAKE_COOKIE,
          await sealHandshake(handshake, config),
          request.url,
        ),
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    // Descoberta fora do ar, DNS errado, emissor divergente. O detalhe vai para
    // o log do provedor de deploy; a resposta diz o que a pessoa pode fazer.
    console.error("[auth] não foi possível iniciar o login:", err);
    return Response.json(
      { error: "não foi possível falar com o provedor de identidade" },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
