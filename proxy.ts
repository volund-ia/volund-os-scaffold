import { NextResponse, type NextRequest } from "next/server";

import {
  AUTH_LOGIN_PATH,
  MissingAuthEnvError,
  SESSION_COOKIE,
  readAuthConfig,
} from "@/lib/auth/config";
import { expectsHtml, isPublicRoute } from "@/lib/auth/route-policy";
import {
  clearedCookie,
  needsRefresh,
  readSealedPayload,
  publicOriginFor,
  refreshSession,
  sealSession,
  sessionCookie,
} from "@/lib/auth/session";

/**
 * Portão de entrada do App: **exige sessão em tudo**, exceto na allow-list
 * enumerada em `lib/auth/route-policy.ts`.
 *
 * ## Este arquivo se chamava `middleware.ts`
 *
 * No Next 16 a convenção foi renomeada para `proxy.ts`, com a função exportada
 * chamando-se `proxy`. É o mesmo mecanismo, com outro nome — e o nome antigo
 * está depreciado.
 *
 * ## Fechado por default, e o que isso custa quando dá errado
 *
 * Uma rota nova criada pelo agente nasce protegida sem ele fazer nada: a
 * proteção vem por herança, não por lembrança. O inverso — auth opcional —
 * faria o App nascer aberto e dependeria de alguém acertar um passo extra. Aqui,
 * esquecer configuração quebra o acesso, o que se vê na hora; lá, abriria o
 * sistema, o que só se vê no incidente.
 *
 * ## O que este arquivo NÃO faz
 *
 * Não verifica permissão — só sessão. E não substitui a checagem dentro de cada
 * limite: uma Server Action é um POST para a rota onde ela é usada, e um
 * `matcher` alterado tira a cobertura daqui sem nenhum sinal. Autorização é no
 * servidor, em cada limite, com `guard()` de `lib/auth/server.ts`.
 */

export const config = {
  matcher: [
    /*
     * Tudo, menos o que nunca carrega decisão de acesso:
     * - `_next/static` e `_next/image`: artefatos de build, servidos pelo CDN
     * - `favicon.ico`, `robots.txt`, `sitemap.xml`: metadados públicos por natureza
     *
     * Rotas de API NÃO estão excluídas, de propósito: elas são o alvo mais
     * provável de quem chama o App sem passar pela interface.
     */
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};

/** Para onde voltar depois do login: caminho + query, nunca absoluto. */
function returnToFor(request: NextRequest): string {
  return `${request.nextUrl.pathname}${request.nextUrl.search}`;
}

/**
 * Sem sessão: navegação vai para o login, chamada de API leva 401.
 *
 * O cookie é apagado junto. Um cookie ilegível — selado com um segredo anterior,
 * adulterado, ou de outra instância — que sobrevivesse à recusa faria a próxima
 * requisição repetir exatamente o mesmo caminho.
 */
function deny(request: NextRequest): NextResponse {
  const response = expectsHtml(request.headers)
    ? NextResponse.redirect(
        new URL(
          `${AUTH_LOGIN_PATH}?returnTo=${encodeURIComponent(returnToFor(request))}`,
          publicOriginFor(request),
        ),
      )
    : NextResponse.json(
        { error: "não autenticado" },
        { status: 401, headers: { "cache-control": "no-store" } },
      );

  response.headers.append("set-cookie", clearedCookie(SESSION_COOKIE, publicOriginFor(request)));
  return response;
}

export async function proxy(request: NextRequest) {
  if (isPublicRoute(request.nextUrl.pathname)) return NextResponse.next();

  let authConfig;
  try {
    authConfig = readAuthConfig();
  } catch (err) {
    // Falha explícita, nomeando a variável — e fechada. Degradar para acesso
    // aberto aqui transformaria um erro de configuração em um sistema exposto.
    const variavel = err instanceof MissingAuthEnvError ? err.variable : null;
    // A variável que falta é o que o requisito manda dizer e o que permite
    // consertar. O resto — quais são as outras, como o ambiente é montado —
    // fica no log: quem recebe esta resposta pode ser qualquer visitante, e
    // enumerar a configuração da plataforma para ele não ajuda ninguém a
    // consertar nada.
    console.error("[auth] App sem configuração de autenticação:", err);
    return NextResponse.json(
      {
        error: "autenticação não configurada",
        ...(variavel ? { variavel } : {}),
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  const payload = await readSealedPayload(
    request.cookies.get(SESSION_COOKIE)?.value,
    authConfig,
  );
  if (!payload?.refreshToken) return deny(request);

  if (!needsRefresh(payload, Math.floor(Date.now() / 1000))) {
    return NextResponse.next();
  }

  // Access token no fim da vida: renova aqui, uma vez, e entrega a requisição já
  // com o cookie novo. É o único lugar do fluxo que roda antes da rota E pode
  // escrever cookie — um Server Component não pode, então renovar lá dentro
  // renderizaria com um token que o navegador nunca receberia.
  try {
    const renovada = await refreshSession({
      config: authConfig,
      refreshToken: payload.refreshToken,
    });
    const selada = await sealSession(renovada, authConfig);

    // Atualiza também a requisição que segue para a rota: sem isto, a rota leria
    // o cookie ANTIGO nesta requisição e só veria o novo na seguinte.
    request.cookies.set(SESSION_COOKIE, selada);
    const response = NextResponse.next({ request });
    response.headers.append("set-cookie", sessionCookie(selada, publicOriginFor(request)));
    return response;
  } catch (err) {
    // Refresh expirado, revogado, ou reapresentado (o provedor derruba a família
    // inteira nesse caso). Todos significam a mesma coisa para quem está aqui:
    // a sessão acabou.
    console.error("[auth] não foi possível renovar a sessão:", err);
    return deny(request);
  }
}
