/**
 * Verificação de token — a parte PURA, sem rede.
 *
 * Recebe o conjunto de chaves já resolvido e devolve os claims, ou uma recusa
 * com motivo. Fica isolada de I/O porque são as regras cuja frouxidão vira "App
 * B aceita como sua a sessão de um usuário do App A": isso precisa ser
 * exercitável em teste, com token forjado de verdade.
 */

import { base64UrlDecode, base64UrlDecodeText } from "./crypto";
import { resourceIdForApp } from "./config";

/** Chave pública no formato do JWKS. Só RS256 — é o que o provedor emite. */
export interface PublicJwk {
  kty: string;
  kid?: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
}

export interface TokenClaims {
  iss: string;
  sub: string;
  aud: string;
  exp: number;
  iat: number;
  /** Presente no access token: o client para quem ele foi emitido. */
  azp?: string;
  /** Id do agente App a que este token pertence. */
  app_id?: string;
  org_id?: string;
  email?: string;
  name?: string;
  nonce?: string;
  scope?: string;
  roles?: string[];
  permissions?: string[];
}

export type VerifyResult =
  { ok: true; claims: TokenClaims } | { ok: false; reason: string };

/**
 * Trinta segundos de tolerância para relógios diferentes. Curto de propósito:
 * o access token vive dez minutos, e uma folga generosa aqui comeria uma fatia
 * significativa dessa vida.
 */
const CLOCK_SKEW_SECONDS = 30;

interface JwtParts {
  header: { alg?: string; kid?: string; typ?: string };
  claims: TokenClaims;
  signedData: Uint8Array<ArrayBuffer>;
  signature: Uint8Array<ArrayBuffer>;
}

function splitJwt(token: string): JwtParts | null {
  const parts = token.split(".");
  const [header, body, signature] = parts;
  // Exatamente três: um token com um quarto segmento é outra coisa (JWE), e
  // ignorá-lo em silêncio faria a verificação recair sobre um pedaço só.
  if (parts.length !== 3 || !header || !body || signature === undefined) return null;
  try {
    return {
      header: JSON.parse(base64UrlDecodeText(header)),
      claims: JSON.parse(base64UrlDecodeText(body)),
      signedData: new TextEncoder().encode(`${header}.${body}`),
      signature: base64UrlDecode(signature),
    };
  } catch {
    return null;
  }
}

/**
 * Confere assinatura, emissor e validade temporal. É o piso comum: nenhum tipo
 * de token passa daqui sem isso.
 *
 * A chave é escolhida pelo `kid` do cabeçalho, e a ausência de `kid` **não**
 * autoriza tentar todas: um token sem `kid` é um token que não sabemos de qual
 * chave veio, e aceitar isso desfaz o benefício da rotação.
 *
 * `alg` é conferido contra `RS256` literal, e não contra o que o token declara.
 * Aceitar o algoritmo anunciado pelo próprio token é a família de falhas do
 * `alg: none` e da confusão RSA/HMAC — quem forja escolhe o algoritmo.
 */
export async function verifySignedToken(
  token: string,
  params: { keys: PublicJwk[]; issuer: string; now?: number },
): Promise<VerifyResult> {
  const parsed = splitJwt(token);
  if (!parsed) return { ok: false, reason: "token malformado" };

  if (parsed.header.alg !== "RS256") {
    return {
      ok: false,
      reason: `algoritmo não aceito: ${parsed.header.alg ?? "ausente"}`,
    };
  }
  if (!parsed.header.kid) {
    return { ok: false, reason: "token sem `kid` no cabeçalho" };
  }

  const jwk = params.keys.find((key) => key.kid === parsed.header.kid);
  if (!jwk) return { ok: false, reason: `chave ${parsed.header.kid} não está no JWKS` };

  let verified: boolean;
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    verified = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      parsed.signature,
      parsed.signedData,
    );
  } catch {
    return { ok: false, reason: "falha ao verificar a assinatura" };
  }
  if (!verified) return { ok: false, reason: "assinatura inválida" };

  const claims = parsed.claims;
  if (claims.iss !== params.issuer) {
    return { ok: false, reason: "emissor diferente do configurado" };
  }

  const now = params.now ?? Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_SECONDS < now) {
    return { ok: false, reason: "token expirado" };
  }
  if (typeof claims.iat === "number" && claims.iat - CLOCK_SKEW_SECONDS > now) {
    return { ok: false, reason: "token emitido no futuro" };
  }
  if (!claims.sub) return { ok: false, reason: "token sem `sub`" };

  return { ok: true, claims };
}

/**
 * ID token — quem valida é o **client**, então `aud` é o `client_id`.
 *
 * O `nonce` é conferido contra o que este App sorteou no início do fluxo. Sem
 * essa amarra, um ID token legítimo capturado em outro login do mesmo App
 * poderia ser reapresentado aqui.
 */
export async function verifyIdToken(
  token: string,
  params: {
    keys: PublicJwk[];
    issuer: string;
    clientId: string;
    nonce?: string;
    now?: number;
  },
): Promise<VerifyResult> {
  const result = await verifySignedToken(token, params);
  if (!result.ok) return result;

  const { claims } = result;
  if (claims.aud !== params.clientId) {
    return { ok: false, reason: "ID token emitido para outro client" };
  }
  if (params.nonce && claims.nonce !== params.nonce) {
    return {
      ok: false,
      reason: "`nonce` não corresponde ao pedido que iniciou o login",
    };
  }
  if (!claims.app_id) {
    return { ok: false, reason: "ID token sem `app_id`" };
  }
  return result;
}

/**
 * Access token — quem valida é o **recurso**, então `aud` é o `resource_id`
 * daquele App, e `azp` é o client que o obteve.
 *
 * ## As duas conferências, e por que são duas
 *
 * `azp === client_id` é a amarra ao **nosso** App: o token de outro App carrega
 * o `client_id` dele, e é isto que faz a recusa acontecer. `aud` conferido
 * contra a forma canônica derivada do `app_id` do próprio token é a checagem de
 * coerência: um token cuja audiência não corresponde ao App que ele diz ser está
 * malformado, mesmo que assinado.
 *
 * Nenhuma das duas sozinha basta. Só `aud` deixaria passar qualquer token cujo
 * `app_id` fosse escolhido pelo emissor do pedido; só `azp` aceitaria um token
 * cuja audiência aponta para outro recurso.
 */
export async function verifyAccessToken(
  token: string,
  params: { keys: PublicJwk[]; issuer: string; clientId: string; now?: number },
): Promise<VerifyResult> {
  const result = await verifySignedToken(token, params);
  if (!result.ok) return result;

  const { claims } = result;
  if (claims.azp !== params.clientId) {
    return { ok: false, reason: "access token obtido por outro client" };
  }
  if (!claims.app_id) {
    return { ok: false, reason: "access token sem `app_id`" };
  }
  if (claims.aud !== resourceIdForApp(claims.app_id)) {
    return { ok: false, reason: "audiência não corresponde ao App do token" };
  }
  return result;
}

/**
 * Lê o `exp` sem verificar nada.
 *
 * Existe para UMA coisa: decidir se vale a pena tentar renovar antes de gastar
 * uma verificação completa. Quem chamar isto para tomar decisão de acesso está
 * usando a função errada — o nome grita por isso.
 */
export function readExpiryWithoutVerifying(token: string): number | null {
  const parsed = splitJwt(token);
  return parsed && typeof parsed.claims.exp === "number" ? parsed.claims.exp : null;
}
