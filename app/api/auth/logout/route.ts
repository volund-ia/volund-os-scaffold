import { SESSION_COOKIE, readAuthConfig } from "@/lib/auth/config";
import {
  clearedCookie,
  readCookie,
  readSealedPayload,
  revokeRefreshToken,
  publicOriginFor,
} from "@/lib/auth/session";

/**
 * `POST /api/auth/logout` — encerra a sessão.
 *
 * **NÃO está na allow-list**, e é o exemplo de por que a liberação é por
 * endpoint e não por prefixo: `/api/auth/` inteiro liberado deixaria esta rota
 * pública sem ninguém decidir isso. Sem sessão não há o que encerrar, então
 * exigir sessão aqui é o comportamento correto.
 *
 * `POST` e não `GET`: uma imagem apontando para um `GET /logout` derrubaria a
 * sessão de quem apenas abrisse uma página de terceiro.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const headers = new Headers({
    // Relativo, e não absoluto de `request.url`: atrás do proxy aquela origem é
    // a interna, e o navegador seria mandado para `localhost` depois de sair.
    location: "/",
    "cache-control": "no-store",
  });
  // O cookie cai primeiro e independentemente do resto: o que a pessoa pediu foi
  // sair, e nada abaixo pode impedir isso.
  headers.append("set-cookie", clearedCookie(SESSION_COOKIE, publicOriginFor(request)));

  try {
    const config = readAuthConfig();
    const payload = await readSealedPayload(
      readCookie(request, SESSION_COOKIE),
      config,
    );
    if (payload?.refreshToken) {
      await revokeRefreshToken(config, payload.refreshToken);
    }
  } catch (err) {
    console.error("[auth] logout seguiu sem revogar no provedor:", err);
  }

  // 303: a resposta a um POST é para ser buscada com GET.
  return new Response(null, { status: 303, headers });
}
