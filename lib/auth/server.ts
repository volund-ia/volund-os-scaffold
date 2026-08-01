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

import { AUTH_LOGIN_PATH, SESSION_COOKIE, readAuthConfig } from "./config";
import { can } from "./permissions";
import { readSession, type Session } from "./session";

/**
 * Sessão atual, ou `null`.
 *
 * Nunca lança por falta de configuração: numa rota pública (a vitrine), pedir a
 * sessão é legítimo e a resposta correta é "não tem". Onde a ausência de
 * configuração precisa gritar é no proxy, que é quem decide o acesso.
 */
export async function getSession(): Promise<Session | null> {
  let config;
  try {
    config = readAuthConfig();
  } catch {
    return null;
  }
  const jar = await cookies();
  return readSession(jar.get(SESSION_COOKIE)?.value, config);
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
