/**
 * Sessão do App: o que fica no cookie, como ele é lido e como é renovado.
 *
 * A sessão é **selada no cookie**, sem tabela de sessão no banco. É o que
 * permite a camada existir sem impor schema ao App — o agente desenha o banco
 * dele sem esbarrar em tabela de infraestrutura. O preço é o teto de tamanho do
 * cookie, e é por isso que só o essencial entra aqui.
 */

import {
  AUTH_CALLBACK_PATH,
  AUTH_SCOPES,
  HANDSHAKE_TTL_SECONDS,
  SESSION_COOKIE,
  type AuthConfig,
} from "./config";
import { seal, unseal } from "./crypto";
import { loadDiscovery, loadJwks } from "./discovery";
import {
  readExpiryWithoutVerifying,
  verifyAccessToken,
  verifyIdToken,
  type TokenClaims,
} from "./jwt";

const SESSION_PURPOSE = "session";
const HANDSHAKE_PURPOSE = "handshake";

/** Trinta dias: o teto do refresh no provedor. O cookie não vive além dele. */
const SESSION_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

/**
 * Renova quando falta menos que isto para o access token expirar, em vez de
 * esperar ele morrer. Sem a folga, uma requisição que chega no último segundo de
 * vida do token seria atendida com um token que expira no meio dela.
 */
const REFRESH_SKEW_SECONDS = 60;

/** O que vai selado no cookie. */
export interface SessionPayload {
  accessToken: string;
  refreshToken: string;
  /** `exp` do access token, em segundos. Cópia para decidir renovação sem parse. */
  accessExp: number;
}

/** O que o código da aplicação enxerga. */
export interface Session {
  userId: string;
  orgId: string;
  appId: string;
  email: string | null;
  name: string | null;
  roles: string[];
  permissions: string[];
  /** Para chamar serviços em nome do usuário. Não coloque isto em HTML. */
  accessToken: string;
}

export interface Handshake {
  state: string;
  nonce: string;
  codeVerifier: string;
  redirectUri: string;
  /** Caminho interno para onde voltar depois do login. Sempre relativo. */
  returnTo: string;
  expiresAt: number;
}

export async function sealHandshake(
  handshake: Handshake,
  config: AuthConfig,
): Promise<string> {
  return seal(handshake, config.clientSecret, HANDSHAKE_PURPOSE);
}

export async function readHandshake(
  sealed: string | undefined | null,
  config: AuthConfig,
  now = Date.now(),
): Promise<Handshake | null> {
  const handshake = await unseal<Handshake>(
    sealed,
    config.clientSecret,
    HANDSHAKE_PURPOSE,
  );
  if (!handshake) return null;
  if (typeof handshake.expiresAt !== "number" || handshake.expiresAt < now) return null;
  return handshake;
}

export async function sealSession(
  payload: SessionPayload,
  config: AuthConfig,
): Promise<string> {
  return seal(payload, config.clientSecret, SESSION_PURPOSE);
}

/**
 * Abre o cookie e **verifica o access token de verdade** — assinatura, emissor,
 * validade, `app_id` e `aud`.
 *
 * Confiar no selo do cookie sozinho seria confiar no que este App escreveu no
 * passado; verificar o token é o que faz a identidade continuar vindo do
 * provedor a cada requisição. É também onde a recusa acontece: um token de
 * outro App, mesmo assinado pela mesma chave e selado com um segredo roubado,
 * tem outra audiência.
 */
export async function readSession(
  sealed: string | undefined | null,
  config: AuthConfig,
): Promise<Session | null> {
  const payload = await unseal<SessionPayload>(
    sealed,
    config.clientSecret,
    SESSION_PURPOSE,
  );
  if (!payload?.accessToken) return null;

  const keys = await loadJwks(config.issuer);
  const result = await verifyAccessToken(payload.accessToken, {
    keys,
    issuer: config.issuer,
    appId: config.appId,
  });
  if (!result.ok) return null;

  return sessionFromClaims(result.claims, payload.accessToken);
}

/**
 * Claims verificados → `Session`.
 *
 * Existe separado porque há **duas** portas de entrada para a mesma sessão: o
 * cookie da tela e o `Authorization: Bearer` do MCP. Se cada uma montasse a
 * `Session` por conta própria, um campo novo entraria numa e não na outra — e o
 * sintoma seria o agente ver uma identidade diferente da que a pessoa vê, o que é
 * exatamente a divergência que esta arquitetura existe para não ter.
 */
function sessionFromClaims(claims: TokenClaims, accessToken: string): Session {
  return {
    userId: claims.sub,
    orgId: claims.org_id ?? "",
    appId: claims.app_id ?? "",
    email: claims.email ?? null,
    name: claims.name ?? null,
    roles: Array.isArray(claims.roles) ? claims.roles : [],
    permissions: Array.isArray(claims.permissions) ? claims.permissions : [],
    accessToken,
  };
}

/**
 * Sessão a partir de um access token apresentado no cabeçalho — o caminho do MCP.
 *
 * É a **mesma** verificação da sessão web: mesmo JWKS, mesmo emissor, mesma
 * audiência (`volund:app:<appAgentId>`), mesmo mapeamento de claims. O que muda
 * é só de onde o token veio — cookie selado numa ponta, cabeçalho na outra. Não
 * há população de identidade própria para o MCP, não há chave por App: o
 * `Session` que chega ao serviço é indistinguível do que chega pela tela.
 *
 * O que MUDA entre as duas portas é quem obteve o token: pela tela é sempre o
 * client deste App; pelo cabeçalho pode ser um cliente de MCP que se registrou
 * sozinho no provedor. Por isso a verificação não olha o `azp` — ver
 * `verifyAccessToken`.
 */
export async function readSessionFromAccessToken(
  accessToken: string | undefined | null,
  config: AuthConfig,
): Promise<Session | null> {
  if (!accessToken) return null;

  const keys = await loadJwks(config.issuer);
  const result = await verifyAccessToken(accessToken, {
    keys,
    issuer: config.issuer,
    appId: config.appId,
  });
  if (!result.ok) return null;

  return sessionFromClaims(result.claims, accessToken);
}

/** A sessão precisa ser renovada antes de ser usada nesta requisição? */
export function needsRefresh(payload: SessionPayload, nowSeconds: number): boolean {
  return payload.accessExp - REFRESH_SKEW_SECONDS <= nowSeconds;
}

export async function readSealedPayload(
  sealed: string | undefined | null,
  config: AuthConfig,
): Promise<SessionPayload | null> {
  return unseal<SessionPayload>(sealed, config.clientSecret, SESSION_PURPOSE);
}

/**
 * Lê um cookie do cabeçalho cru.
 *
 * Existe aqui, e não em cada rota, porque as rotas de autenticação precisam ler
 * cookie **sem** `next/headers` — o helper do Next exige contexto de requisição
 * do framework, e sem ele o handler não pode ser exercitado em teste. Uma cópia
 * por rota já começou a acontecer; centralizar impede que uma delas divirja.
 */
export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

/**
 * Teto de espera pelo provedor de identidade.
 *
 * `fetch` não tem timeout por default: um provedor lento ou travado deixaria a
 * requisição do usuário pendurada até o limite da plataforma. Cinco segundos é
 * folgado para uma chamada servidor-a-servidor e curto o bastante para virar
 * erro tratável em vez de página que não carrega.
 */
const PROVIDER_TIMEOUT_MS = 5_000;

interface TokenEndpointResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

/**
 * Autenticação do client no token endpoint por `client_secret_basic`.
 *
 * Os dois campos vão percent-encoded (RFC 6749 §2.3.1) — um segredo com `:` ou
 * caractere não-ASCII quebraria a decodificação do outro lado sem isso.
 *
 * Exportada porque a troca de token do canal de agentes (`lib/volund/agents.ts`)
 * fala com o MESMO token endpoint e precisa se autenticar do MESMO jeito. Uma
 * segunda cópia divergiria justamente no percent-encoding acima — e o sintoma
 * seria "o login funciona mas o chat não entra", com o segredo certo dos dois
 * lados.
 */
export function basicAuthHeader(config: AuthConfig): string {
  const raw = `${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`;
  return `Basic ${Buffer.from(raw, "utf8").toString("base64")}`;
}

async function callTokenEndpoint(
  config: AuthConfig,
  body: URLSearchParams,
): Promise<TokenEndpointResponse> {
  const discovery = await loadDiscovery(config.issuer);
  const response = await fetch(discovery.token_endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: basicAuthHeader(config),
      accept: "application/json",
    },
    body: body.toString(),
    // O token endpoint não é cacheável (RFC 6749 §5.1) e a resposta carrega
    // credencial: qualquer camada guardando isto entregaria a sessão ao próximo.
    cache: "no-store",
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });

  const data = (await response.json().catch(() => ({}))) as TokenEndpointResponse;
  if (!response.ok || data.error) {
    // A descrição vem do provedor e é segura para log — não carrega o segredo,
    // que nunca aparece na resposta. Para o usuário, quem chama devolve genérico.
    throw new Error(
      `token endpoint recusou: ${data.error ?? response.status} ${data.error_description ?? ""}`.trim(),
    );
  }
  if (!data.access_token || !data.refresh_token) {
    throw new Error("token endpoint respondeu sem `access_token` ou `refresh_token`");
  }
  return data;
}

function toPayload(data: TokenEndpointResponse, nowSeconds: number): SessionPayload {
  const accessToken = data.access_token as string;
  return {
    accessToken,
    refreshToken: data.refresh_token as string,
    // O `exp` do próprio token manda; `expires_in` é a estimativa do provedor e
    // o relógio daqui pode divergir do dele.
    accessExp:
      readExpiryWithoutVerifying(accessToken) ?? nowSeconds + (data.expires_in ?? 600),
  };
}

/**
 * Troca o código de autorização por tokens e valida o ID token.
 *
 * O `nonce` é conferido aqui, contra o valor sorteado no início do fluxo — é o
 * que amarra este ID token ao pedido que este navegador iniciou.
 */
export async function exchangeCode(params: {
  config: AuthConfig;
  code: string;
  handshake: Handshake;
  nowSeconds?: number;
}): Promise<SessionPayload> {
  const { config, code, handshake } = params;
  const nowSeconds = params.nowSeconds ?? Math.floor(Date.now() / 1000);

  const data = await callTokenEndpoint(
    config,
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: handshake.redirectUri,
      code_verifier: handshake.codeVerifier,
    }),
  );

  if (!data.id_token) throw new Error("token endpoint respondeu sem `id_token`");

  const keys = await loadJwks(config.issuer);
  const idResult = await verifyIdToken(data.id_token, {
    keys,
    issuer: config.issuer,
    clientId: config.clientId,
    nonce: handshake.nonce,
  });
  if (!idResult.ok) throw new Error(`ID token recusado: ${idResult.reason}`);

  const accessResult = await verifyAccessToken(data.access_token as string, {
    keys,
    issuer: config.issuer,
    appId: config.appId,
  });
  if (!accessResult.ok)
    throw new Error(`access token recusado: ${accessResult.reason}`);

  return toPayload(data, nowSeconds);
}

/**
 * Rotaciona o refresh token. O provedor devolve um novo a cada uso e derruba a
 * família inteira se o anterior reaparecer — guardar o antigo depois disto
 * derrubaria a própria sessão no uso seguinte.
 */
export async function refreshSession(params: {
  config: AuthConfig;
  refreshToken: string;
  nowSeconds?: number;
}): Promise<SessionPayload> {
  const nowSeconds = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  const data = await callTokenEndpoint(
    params.config,
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: params.refreshToken,
    }),
  );
  return toPayload(data, nowSeconds);
}

/**
 * Revoga o refresh token no provedor. Best-effort **de propósito**.
 *
 * Sair do App é uma ação local: apagar o cookie encerra a sessão aqui, e é isso
 * que o usuário pediu. A revogação impede que o refresh guardado continue
 * rendendo token novo por até trinta dias — mas se o provedor estiver fora do
 * ar, travar o logout seria deixar a pessoa presa dentro do App por causa de uma
 * limpeza que ela não pediu.
 */
export async function revokeRefreshToken(
  config: AuthConfig,
  refreshToken: string,
): Promise<void> {
  try {
    const discovery = await loadDiscovery(config.issuer);
    if (!discovery.revocation_endpoint) return;
    await fetch(discovery.revocation_endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: basicAuthHeader(config),
      },
      body: new URLSearchParams({
        token: refreshToken,
        token_type_hint: "refresh_token",
      }).toString(),
      cache: "no-store",
      // Sair não pode ficar preso esperando o provedor: o cookie já caiu antes
      // desta chamada, e a revogação é o zelo extra.
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
  } catch (err) {
    console.error("[auth] falha ao revogar o refresh token no provedor:", err);
  }
}

/** Monta a URL de autorização a partir do que a descoberta anunciou. */
export async function buildAuthorizationUrl(params: {
  config: AuthConfig;
  handshake: Handshake;
  codeChallenge: string;
}): Promise<string> {
  const discovery = await loadDiscovery(params.config.issuer);
  const url = new URL(discovery.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", params.config.clientId);
  url.searchParams.set("redirect_uri", params.handshake.redirectUri);
  url.searchParams.set("scope", AUTH_SCOPES.join(" "));
  url.searchParams.set("state", params.handshake.state);
  url.searchParams.set("nonce", params.handshake.nonce);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

/**
 * `redirect_uri` desta requisição.
 *
 * Derivada da origem por onde o usuário chegou, porque a plataforma registra uma
 * entrada por endereço conhecido do App (produção, prévia, domínio próprio,
 * sandbox de desenvolvimento) — usar a origem da requisição faz o login
 * funcionar em todas sem configuração por ambiente. A conferência do lado do
 * provedor continua sendo por igualdade exata contra a lista registrada: uma
 * origem que ele não conhece é recusada lá, não aqui.
 */
export function callbackUriFor(requestUrl: string | URL): string {
  return new URL(AUTH_CALLBACK_PATH, requestUrl).toString();
}

/**
 * A origem PÚBLICA desta requisição — a que o navegador realmente usou.
 *
 * ## Por que `request.url` não serve sozinho
 *
 * Em produção e no ambiente de desenvolvimento a aplicação roda atrás de um
 * proxy reverso. O proxy encaminha para a porta interna, e `request.url` traz
 * essa origem interna (`http://localhost:3000`) — não o endereço que a pessoa
 * digitou.
 *
 * Isso arrebentava o login inteiro, e de um jeito difícil de ler: a plataforma
 * registra o endereço PÚBLICO como `redirect_uri` e compara por igualdade exata
 * (RFC 9700, sem curinga). O `redirect_uri` montado de `request.url` nunca
 * batia, e a tentativa de entrar morria em "endereço de retorno não registrado"
 * — com o dedo apontado para o registro, que estava certo.
 *
 * ## A regra, e por que ela é assim
 *
 * **Com `x-forwarded-host`: o host vem do header e o esquema é `https`, sempre.**
 * **Sem ele: vale a origem do próprio pedido, `request.url`.**
 *
 * O esquema NÃO é lido de `x-forwarded-proto`, e essa omissão é o ponto. Esta
 * origem também decide o `Secure` do cookie (`isSecureRequest`), então qualquer
 * caminho que deixasse um header REBAIXAR o esquema seria uma forma de tirar o
 * `Secure` da sessão de um site HTTPS com um pedido forjado.
 *
 * Com a regra acima, forjar `x-forwarded-host` só consegue LIGAR o `Secure`,
 * nunca desligar — inclusive forjando `localhost`, que continua produzindo
 * `https://localhost`. É a direção segura do erro.
 *
 * A contrapartida aceita: um proxy local servindo texto claro receberia cookie
 * com `Secure`. Não quebra nada — `localhost` é contexto seguro para os
 * navegadores, que aceitam `Secure` ali —, e não existe implantação suportada
 * deste scaffold servindo em `http` atrás de proxy.
 *
 * Sobre o host em si: ele é falsificável, e a contenção é o provedor. O
 * `redirect_uri` derivado dele é conferido contra a lista registrada, por
 * igualdade exata. Um host forjado produz autorização RECUSADA — nunca um
 * código de autorização entregue noutro lugar.
 */
export function publicOriginFor(request: Request): string {
  const forwardedHost = firstForwarded(request.headers.get("x-forwarded-host"));

  // Sem proxy: a origem do pedido é a verdade, e é dela que sai também a exceção
  // de `localhost` do desenvolvimento direto.
  if (!forwardedHost) return new URL(request.url).origin;

  try {
    return new URL(`https://${forwardedHost}`).origin;
  } catch {
    return new URL(request.url).origin;
  }
}

/** `x-forwarded-host` pode vir com a cadeia inteira (`a, b, c`). Vale o primeiro. */
function firstForwarded(value: string | null): string | null {
  const first = value?.split(",")[0]?.trim();
  return first ? first : null;
}

interface CookieOptions {
  maxAge: number;
  secure: boolean;
}

/**
 * O App também roda DENTRO do painel do VolundOS, num iframe entre sites — e é
 * isso que decide os atributos abaixo.
 *
 * `SameSite=Lax` foi a primeira escolha, e ela é correta para uma aba: o
 * callback chega como navegação de topo vinda do provedor, e `Strict` esconderia
 * o cookie do aperto de mão exatamente na requisição que precisa dele.
 *
 * Só que no painel o App é enquadrado por `os.volund.com.br`, e aí o contexto é
 * de TERCEIRO. O navegador não guarda nem devolve cookie `Lax` nesse contexto, e
 * o efeito medido em 03/08/2026 foi: o login começa, o provedor devolve o
 * `code`, e o callback não acha o próprio pedido — `400`, "pedido de login não
 * encontrado ou expirado". Em aba separada, o mesmo App entrava sem problema.
 *
 * `SameSite=None` sozinho resolveria e cobraria caro: a sessão passaria a viajar
 * em TODA requisição entre sites, e qualquer rota de escrita ficaria alcançável
 * por CSRF sem defesa própria. `Partitioned` (CHIPS) é o meio termo que a
 * plataforma escolheu: o cookie existe no iframe, mas o pote é separado por site
 * que enquadra. Outro site que embuta este App recebe um pote diferente e não vê
 * a sessão daqui — deixa de ser cookie de terceiro no sentido que importa, e
 * sobrevive ao fim dos cookies de terceiro no Chrome.
 *
 * ## O que muda para quem usa
 *
 * A sessão de dentro do painel e a de uma aba separada passam a ser DUAS. Entrar
 * numa não entra na outra. É o preço do isolamento, e é preferível ao contrário:
 * uma sessão só, visível a qualquer site que resolva enquadrar o App.
 *
 * ## Por que o desenvolvimento local continua `Lax`
 *
 * `SameSite=None` sem `Secure` é recusado pelo navegador, e `Partitioned` exige
 * `Secure`. Em `http://localhost` não há `Secure` — mandar `None` ali deixaria o
 * cookie ser descartado e o login pararia de funcionar na máquina de quem
 * desenvolve. Endereço local não é enquadrado por ninguém, então `Lax` serve.
 */
function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [`${name}=${value}`, "Path=/", "HttpOnly"];

  if (options.secure) {
    parts.push("SameSite=None", "Secure", "Partitioned");
  } else {
    parts.push("SameSite=Lax");
  }

  parts.push(`Max-Age=${options.maxAge}`);
  return parts.join("; ");
}

/**
 * `Secure` em tudo, MENOS no endereço local de desenvolvimento.
 *
 * A pergunta natural seria "o protocolo desta requisição é https?", e é a
 * pergunta errada: atrás de um proxy reverso — que é como o App roda em
 * produção — a requisição chega ao Next como `http`, e o `https` só existe no
 * `x-forwarded-proto`, que é um cabeçalho que o cliente pode forjar. Decidir por
 * ele significaria que basta mandar `x-forwarded-proto: http` para o cookie de
 * sessão sair sem `Secure` e passar a viajar em texto claro.
 *
 * Por isso a regra é invertida: `Secure` é o default, e a exceção é o host local
 * (onde não há TLS e o cookie simplesmente não seria aceito com `Secure`).
 */
function isSecureRequest(requestUrl: string | URL): boolean {
  const { hostname } = new URL(requestUrl);
  return hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "[::1]";
}

export function sessionCookie(value: string, requestUrl: string | URL): string {
  return serializeCookie(SESSION_COOKIE, value, {
    maxAge: SESSION_COOKIE_MAX_AGE,
    secure: isSecureRequest(requestUrl),
  });
}

export function handshakeCookie(
  name: string,
  value: string,
  requestUrl: string | URL,
): string {
  return serializeCookie(name, value, {
    maxAge: HANDSHAKE_TTL_SECONDS,
    secure: isSecureRequest(requestUrl),
  });
}

export function clearedCookie(name: string, requestUrl: string | URL): string {
  return serializeCookie(name, "", { maxAge: 0, secure: isSecureRequest(requestUrl) });
}

/**
 * Destino de retorno depois do login.
 *
 * Só caminho interno: um `returnTo` que aceitasse endereço absoluto viraria
 * redirecionamento aberto, e um App autenticado é justamente o lugar onde isso
 * seria usado para levar quem acabou de entrar para uma página que imita a dele.
 *
 * ## Validar exatamente o que o navegador vai ver
 *
 * Duas armadilhas, e as duas vêm da mesma raiz: **o navegador não lê a string
 * que nós conferimos**. Ele a normaliza antes.
 *
 * 1. `\` conta como `/` ao resolver endereço, então `//outro.site` e
 *    `/\outro.site` saem do domínio do mesmo jeito. Barrar só o primeiro deixa
 *    o segundo passar sem nem parecer suspeito.
 * 2. TAB, CR e LF são **removidos** do endereço (WHATWG URL). Isso significa que
 *    `/\t/outro.site` chega aqui com três caracteres na frente — passa por
 *    `startsWith("/")`, passa pela checagem das duas primeiras posições — e
 *    vira `//outro.site` na hora em que o navegador o interpreta. O
 *    redirecionamento aberto acontece depois da nossa aprovação.
 *
 * Por isso a normalização vem ANTES das checagens, e é o valor normalizado que
 * volta: o que foi conferido e o que será usado precisam ser a mesma string.
 */
export function safeReturnTo(raw: string | null | undefined): string {
  if (!raw) return "/";
  const normalizado = raw.replace(/[\t\r\n]/g, "");
  if (!normalizado.startsWith("/")) return "/";
  if (/^[/\\]{2}/.test(normalizado)) return "/";
  return normalizado;
}
