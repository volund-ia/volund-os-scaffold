/**
 * Quais rotas são públicas — a regra PURA, sem Next e sem rede, para poder ser
 * exercitada em teste.
 *
 * ## A lista é enumerada, nunca por prefixo
 *
 * Liberar `/api/auth/*` de uma vez pareceria equivalente e é onde a falha mora:
 * qualquer rota criada depois debaixo daquela árvore nasceria pública sem
 * ninguém decidir isso. O que precisa ser público é só o **bootstrap** do
 * login — as duas rotas que, por definição, são chamadas antes de existir
 * sessão. `/api/auth/logout` não é uma delas e continua exigindo sessão.
 *
 * Acrescentar uma rota aqui é uma decisão de segurança. Ela deve vir com o
 * motivo escrito ao lado.
 */

import { AUTH_CALLBACK_PATH, AUTH_LOGIN_PATH } from "./config";

export const PUBLIC_ROUTES: readonly string[] = [
  // Vitrine. Existe para que o endereço publicado abra para qualquer visitante
  // — inclusive dentro da prévia do VolundOS, que não carrega cookies — sem
  // expor o sistema. Tudo além dela exige sessão.
  "/",
  // Início do fluxo: quem chega aqui está justamente sem sessão.
  AUTH_LOGIN_PATH,
  // Retorno do provedor. Protegê-lo faria o login nunca terminar: ele é
  // chamado antes de a sessão existir, e é ele quem a estabelece.
  AUTH_CALLBACK_PATH,
];

/**
 * Comparação exata, com a barra final normalizada.
 *
 * Sem a normalização, `/` e `//` ou `/api/auth/callback/` seriam caminhos
 * diferentes do registrado — e a diferença apareceria como login que não
 * termina, não como erro.
 */
export function isPublicRoute(pathname: string): boolean {
  const normalized =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.replace(/\/+$/, "")
      : pathname;
  return PUBLIC_ROUTES.includes(normalized || "/");
}

/**
 * A requisição espera HTML (e portanto um redirecionamento para o login), ou
 * espera dado (e portanto um 401)?
 *
 * Responder 307 para um `fetch` de API entregaria HTML de login onde o cliente
 * espera JSON, e o erro apareceria como falha de parse — longe da causa.
 */
export function expectsHtml(headers: Headers): boolean {
  const accept = headers.get("accept") ?? "";
  return accept.includes("text/html");
}
