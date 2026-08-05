/**
 * A superfície que o código da aplicação usa: pegar a sessão, exigir sessão,
 * exigir permissão.
 *
 * Só isto deveria ser importado pelas páginas e rotas. O resto de `lib/auth/` é
 * a mecânica do protocolo.
 *
 * ## Por que o guard existe se o `proxy.ts` já protege tudo
 *
 * Porque o proxy protege **rotas**, e nem todo limite é uma rota. Uma Server
 * Action é um POST para a rota onde ela é usada; um `matcher` alterado, um
 * arquivo movido, uma rota nova excluída sem querer — qualquer um desses tira a
 * cobertura do proxy sem nenhum sinal. A documentação do próprio Next é explícita
 * nisso: verifique autenticação e autorização dentro de cada limite, não confie
 * só no proxy. Aqui é onde essa segunda checagem mora.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  AUTH_LOGIN_PATH,
  SESSION_COOKIE,
  readAuthConfig,
  type AuthConfig,
} from "./config";
import { can } from "./permissions";
import { readSession, readSessionFromAccessToken, type Session } from "./session";

/**
 * Sessão atual, ou `null`.
 *
 * Nunca lança por falta de configuração: numa rota pública (a vitrine), pedir a
 * sessão é legítimo e a resposta correta é "não tem". Onde a ausência de
 * configuração precisa gritar é no proxy, que é quem decide o acesso.
 */
export async function getSession(): Promise<Session | null> {
  let config: AuthConfig;
  try {
    config = readAuthConfig();
  } catch {
    return null;
  }
  const jar = await cookies();
  return readSession(jar.get(SESSION_COOKIE)?.value, config);
}

/**
 * Portão de quem chega com `Authorization: Bearer <access token>` — a porta do
 * MCP.
 *
 * Não é uma autenticação nova: é a **mesma** validação da sessão web sobre um
 * token que veio no cabeçalho em vez do cookie (ver
 * `readSessionFromAccessToken`). Um agente que chama o MCP deste App apresenta o
 * mesmo access token que o navegador da pessoa apresentaria, e o `can()` responde
 * a mesma coisa para os dois.
 *
 * ## Por que ele distingue "não provou" de "não deu para verificar"
 *
 * **401** é para quem não provou identidade: sem cabeçalho, esquema diferente de
 * `Bearer`, token inválido, expirado, ou de outro App. Um só motivo na resposta,
 * porque detalhar ajudaria quem está adivinhando.
 *
 * **503** é para quando a verificação não pôde acontecer: o provedor de
 * identidade fora do ar com o cache de chaves frio, ou a configuração da
 * autenticação ausente. Responder 401 nesse caso seria dizer ao cliente que o
 * token dele está ruim — e um cliente que acredita nisso **descarta um token
 * bom** e refaz o login que não vai funcionar. A falha é nossa, e o status tem de
 * dizer isso: 503 é retentável, 401 não.
 *
 * O detalhe do erro vai para o log do provedor de deploy, nunca para a resposta.
 */
export type BearerGate =
  { ok: true; session: Session } | { ok: false; response: Response };

function recusaBearer(status: 401 | 503, erro: string): BearerGate {
  const headers: Record<string, string> = { "cache-control": "no-store" };
  if (status === 401) {
    // Diz ao cliente MCP COMO se autenticar, e não só que ele falhou.
    headers["www-authenticate"] = 'Bearer realm="volund", error="invalid_token"';
  }
  return { ok: false, response: Response.json({ error: erro }, { status, headers }) };
}

export async function bearerGate(request: Request): Promise<BearerGate> {
  let config: AuthConfig;
  try {
    config = readAuthConfig();
  } catch (err) {
    // Sem as variáveis não há como verificar nada. É falha de configuração
    // nossa, e o proxy responde 503 pelo mesmo motivo — nunca degradar para
    // acesso aberto, nunca culpar o token de quem chamou.
    console.error("[auth] MCP sem configuração de autenticação:", err);
    return recusaBearer(503, "autenticação não configurada");
  }

  const header = request.headers.get("authorization") ?? "";
  const [esquema, token] = header.split(" ");
  if (esquema?.toLowerCase() !== "bearer" || !token) {
    return recusaBearer(401, "não autenticado");
  }

  let session: Session | null;
  try {
    session = await readSessionFromAccessToken(token, config);
  } catch (err) {
    // Descoberta OIDC ou JWKS indisponíveis com o cache frio: `loadJwks` recua
    // para o cache velho quando existe, e lança quando não existe. Deixar a
    // exceção subir daqui viraria erro não tratado no handler do MCP.
    console.error("[auth] não foi possível verificar o token do MCP:", err);
    return recusaBearer(503, "não foi possível verificar a autenticação");
  }

  if (!session) return recusaBearer(401, "não autenticado");
  return { ok: true, session };
}

export type Gate =
  | { ok: true; session: Session }
  | { ok: false; session: Session | null; response: Response };

/**
 * Portão para rotas de API e Server Actions.
 *
 * ```ts
 * const gate = await guard();
 * if (!gate.ok) return gate.response;
 * // daqui para baixo, `gate.session` existe
 * ```
 *
 * `permission` é opcional **e hoje nega todo mundo quando informada** — veja o
 * aviso em `lib/auth/permissions.ts` antes de usá-la.
 */
export async function guard(options: { permission?: string } = {}): Promise<Gate> {
  const session = await getSession();

  if (!session) {
    return {
      ok: false,
      session: null,
      response: Response.json(
        { error: "não autenticado" },
        { status: 401, headers: { "cache-control": "no-store" } },
      ),
    };
  }

  if (options.permission && !can(session, options.permission)) {
    // 403 e não 404: quem chegou aqui está autenticado, e esconder a existência
    // do recurso de quem já entrou no sistema só dificulta o diagnóstico.
    return {
      ok: false,
      session,
      response: Response.json(
        { error: "sem permissão", permissao: options.permission },
        { status: 403, headers: { "cache-control": "no-store" } },
      ),
    };
  }

  return { ok: true, session };
}

/**
 * Para páginas (Server Components): devolve a sessão ou manda para o login.
 *
 * Em página, 401 seria uma tela branca. O certo é levar ao login e voltar para
 * onde a pessoa estava.
 */
export async function requireSession(returnTo = "/"): Promise<Session> {
  const session = await getSession();
  if (session) return session;

  // `redirect` interrompe a renderização lançando — nada depois desta linha
  // executa. Vale para páginas; em rota de API use `guard()`, que devolve a
  // resposta em vez de desviar.
  redirect(`${AUTH_LOGIN_PATH}?returnTo=${encodeURIComponent(returnTo)}`);
}
