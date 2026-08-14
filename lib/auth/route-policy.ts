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
 *
 * ## Arquivo em `public/` também exige sessão — e isso é deliberado
 *
 * O `matcher` do `proxy.ts` dispensa `_next/static` e `_next/image` (artefatos
 * de build) e os metadados de sempre. **Um arquivo que você ponha em `public/`
 * NÃO está dispensado**: `/imagens/capa.png` cai no portão e é negado sem
 * sessão, como qualquer outra rota.
 *
 * Parece incômodo até lembrar o que a alternativa custa. `public/` é onde se
 * larga arquivo sem pensar — o PDF que alguém mandou por e-mail, o CSV de um
 * relatório. Dispensar a pasta inteira publicaria tudo isso para a internet, e
 * o dono do App descobriria pelo incidente. Um destino de asset que a vitrine
 * precisa é uma decisão consciente, então ele entra na lista abaixo, com o
 * motivo ao lado — igual às outras entradas.
 *
 * Sintoma quando alguém esquece: a imagem da vitrine não carrega (o portão
 * responde 401 para quem pede `image/*`). Não é falha silenciosa.
 */

import {
  AUTH_CALLBACK_PATH,
  AUTH_LOGIN_PATH,
  PROTECTED_RESOURCE_METADATA_PATH,
} from "./config";

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
  // Endpoint MCP. Público **para o portão de cookie**, e não para o mundo: quem
  // chama é um agente, que apresenta `Authorization: Bearer <access token>` e não
  // tem cookie nenhum. Exigir sessão de cookie aqui recusaria toda chamada de
  // agente antes de o token ser sequer lido.
  //
  // O portão continua existindo, e é o próprio endpoint: sem token válido ele
  // responde 401 (`app/api/mcp/route.ts`), e cada tool passa pelo `can()` do
  // serviço. Enumerar esta rota aqui troca UM portão por outro — não remove
  // nenhum.
  "/api/mcp",
  // Introspecção da superfície (contrato 4). Público **para o portão de
  // cookie**, e não para o mundo: quem chama é a PLATAFORMA, servidor a
  // servidor, e não tem cookie nenhum.
  //
  // O portão continua existindo e é a ASSINATURA: a rota confere um HMAC sobre
  // o caminho e o instante, feito com o segredo que as duas pontas já
  // compartilham (`app/api/_volund/surface/route.ts`). Sem ela, 401. Nenhum
  // agente e nenhuma pessoa passam por aqui — é o único caminho que devolve a
  // lista de tools SEM o filtro de `can()`, e é por isso que ele não é para
  // gente.
  "/api/_volund/surface",
  // Metadado de descoberta (RFC 9728). Público porque é lido ANTES de existir
  // qualquer token — é a definição de metadado de descoberta, e a spec de
  // autorização do MCP manda o cliente buscá-lo sem credencial.
  //
  // Aqui não há "um portão trocado por outro", como nas duas rotas acima: este
  // documento é público de verdade. E não há nada a proteger nele — são o
  // endereço do endpoint MCP e o do servidor de autorização, os dois já
  // conhecidos por qualquer um que tenha o link do App.
  //
  // O caminho é o PÚBLICO, e não o do handler (`/api/oauth-protected-resource`):
  // o proxy vê o caminho antes do rewrite.
  PROTECTED_RESOURCE_METADATA_PATH,
  // Asset que a vitrine precisa mostrar a quem ainda não entrou vem aqui, um
  // por linha e com o motivo ao lado. Exemplo:
  //   "/imagens/capa.png",  // ilustração da vitrine
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
