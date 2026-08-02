// A sessão vista de fora: o que acontece quando alguém chama a API direto, sem
// passar pela interface.
//
// Aqui o JWKS é servido por um `fetch` de mentira, para que a leitura da sessão
// percorra o caminho real — descoberta, chaves, verificação — em vez de um
// atalho que não existiria em produção.
import assert from "node:assert/strict";
import { before, beforeEach, test } from "node:test";

import type { AuthConfig } from "../lib/auth/config";
import { base64UrlEncode, seal } from "../lib/auth/crypto";
import { resetDiscoveryCacheForTests } from "../lib/auth/discovery";
import type { PublicJwk } from "../lib/auth/jwt";
import {
  needsRefresh,
  readHandshake,
  readSession,
  safeReturnTo,
  type SessionPayload,
} from "../lib/auth/session";

const ISSUER = "https://provedor.exemplo.test";
const APP_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const APP_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const KID = "kid-1";

const configA: AuthConfig = {
  issuer: ISSUER,
  clientId: "client-a",
  clientSecret: "segredo-do-app-a",
};
const configB: AuthConfig = {
  issuer: ISSUER,
  clientId: "client-b",
  clientSecret: "segredo-do-app-b",
};

let privateKey: CryptoKey;
let jwks: { keys: PublicJwk[] };

before(async () => {
  const par = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  privateKey = par.privateKey;
  const jwk = (await crypto.subtle.exportKey("jwk", par.publicKey)) as PublicJwk;
  jwks = {
    keys: [{ kty: jwk.kty, n: jwk.n, e: jwk.e, kid: KID, alg: "RS256", use: "sig" }],
  };

  // O provedor, de mentira: só descoberta e JWKS. Nenhum teste aqui fala com a
  // rede de verdade.
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/.well-known/openid-configuration")) {
      return Response.json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/oauth/authorize`,
        token_endpoint: `${ISSUER}/oauth/token`,
        userinfo_endpoint: `${ISSUER}/oauth/userinfo`,
        jwks_uri: `${ISSUER}/.well-known/jwks.json`,
        revocation_endpoint: `${ISSUER}/oauth/revoke`,
      });
    }
    if (url.endsWith("/.well-known/jwks.json")) return Response.json(jwks);
    throw new Error(`fetch inesperado no teste: ${url}`);
  }) as typeof fetch;
});

beforeEach(() => resetDiscoveryCacheForTests());

const agora = () => Math.floor(Date.now() / 1000);

async function accessToken(appId: string, clientId: string): Promise<string> {
  const encoder = new TextEncoder();
  const cabecalho = base64UrlEncode(
    encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT", kid: KID })),
  );
  const corpo = base64UrlEncode(
    encoder.encode(
      JSON.stringify({
        iss: ISSUER,
        sub: "usuario-1",
        aud: `volund:app:${appId}`,
        azp: clientId,
        app_id: appId,
        org_id: "org-1",
        email: "pessoa@exemplo.test",
        name: "Pessoa",
        roles: [],
        permissions: [],
        iat: agora(),
        exp: agora() + 600,
      }),
    ),
  );
  const assinatura = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    encoder.encode(`${cabecalho}.${corpo}`),
  );
  return `${cabecalho}.${corpo}.${base64UrlEncode(new Uint8Array(assinatura))}`;
}

async function cookieDe(
  config: AuthConfig,
  appId: string,
  clientId: string,
): Promise<string> {
  const payload: SessionPayload = {
    accessToken: await accessToken(appId, clientId),
    refreshToken: "refresh-de-teste",
    accessExp: agora() + 600,
  };
  return seal(payload, config.clientSecret, "session");
}

test("sem cookie não há sessão", async () => {
  assert.equal(await readSession(undefined, configA), null);
  assert.equal(await readSession("", configA), null);
  assert.equal(await readSession("qualquer-coisa", configA), null);
});

test("cookie legítimo devolve a identidade do provedor", async () => {
  const sessao = await readSession(
    await cookieDe(configA, APP_A, configA.clientId),
    configA,
  );
  assert.ok(sessao);
  assert.equal(sessao.userId, "usuario-1");
  assert.equal(sessao.orgId, "org-1");
  assert.equal(sessao.appId, APP_A);
  assert.equal(sessao.email, "pessoa@exemplo.test");
  // Token sem nenhuma concessão: o catálogo existe, mas ninguém concedeu nada a
  // esta pessoa ainda. É essa lista vazia que faz `can()` negar por default —
  // nenhum acesso nasce implícito.
  assert.deepEqual(sessao.permissions, []);
});

test("cookie de outro App não vira sessão aqui", async () => {
  // O cenário completo: alguém que tem o cookie do App A o apresenta ao App B.
  // O selo é aberto (segredo diferente já barraria), mas mesmo supondo o segredo
  // conhecido, o token não passa pela conferência de audiência.
  const cookieForjado = await seal(
    {
      accessToken: await accessToken(APP_A, configA.clientId),
      refreshToken: "refresh",
      accessExp: agora() + 600,
    },
    configB.clientSecret,
    "session",
  );
  assert.equal(await readSession(cookieForjado, configB), null);

  // E o selo com o segredo do App A também não abre no App B.
  assert.equal(
    await readSession(await cookieDe(configA, APP_A, configA.clientId), configB),
    null,
  );
  assert.equal(
    await readSession(await cookieDe(configB, APP_B, configB.clientId), configA),
    null,
  );
});

test("token expirado no cookie não vira sessão", async () => {
  const encoder = new TextEncoder();
  const cabecalho = base64UrlEncode(
    encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT", kid: KID })),
  );
  const corpo = base64UrlEncode(
    encoder.encode(
      JSON.stringify({
        iss: ISSUER,
        sub: "usuario-1",
        aud: `volund:app:${APP_A}`,
        azp: configA.clientId,
        app_id: APP_A,
        iat: agora() - 7200,
        exp: agora() - 3600,
      }),
    ),
  );
  const assinatura = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    encoder.encode(`${cabecalho}.${corpo}`),
  );
  const vencido = `${cabecalho}.${corpo}.${base64UrlEncode(new Uint8Array(assinatura))}`;

  const cookie = await seal(
    { accessToken: vencido, refreshToken: "refresh", accessExp: agora() - 3600 },
    configA.clientSecret,
    "session",
  );
  assert.equal(await readSession(cookie, configA), null);
});

test("returnTo só aceita caminho interno", () => {
  // Um App autenticado é justamente onde um redirecionamento aberto seria usado
  // para levar quem acabou de entrar a uma página que imita a dele.
  assert.equal(safeReturnTo("/painel"), "/painel");
  assert.equal(safeReturnTo("/painel?a=1"), "/painel?a=1");
  assert.equal(safeReturnTo("https://outro.site/phishing"), "/");
  assert.equal(safeReturnTo("//outro.site"), "/");
  // O navegador trata `\` como `/` ao resolver endereço: estas saem do domínio
  // exatamente como `//`, e passam despercebidas numa leitura rápida.
  assert.equal(safeReturnTo("/\\outro.site"), "/");
  assert.equal(safeReturnTo("\\\\outro.site"), "/");
  // TAB, CR e LF são REMOVIDOS do endereço pelo navegador. Cada um destes vira
  // `//outro.site` na hora da interpretação — ou seja, depois de já ter passado
  // por uma checagem ingênua das duas primeiras posições.
  assert.equal(safeReturnTo("/\t/outro.site"), "/");
  assert.equal(safeReturnTo("/\n/outro.site"), "/");
  assert.equal(safeReturnTo("/\r/outro.site"), "/");
  assert.equal(safeReturnTo("/\t\\outro.site"), "/");
  assert.equal(safeReturnTo("/\r\n/outro.site"), "/");
  // Caminho legítimo com esses caracteres no meio: o que volta é o que o
  // navegador veria, e não a string crua — conferir uma e usar outra é o buraco.
  assert.equal(safeReturnTo("/pai\tnel"), "/painel");
  assert.equal(safeReturnTo(null), "/");
  assert.equal(safeReturnTo(""), "/");
});

test("a renovação começa antes de o token morrer, não depois", () => {
  const agoraS = agora();
  const com = (exp: number): SessionPayload => ({
    accessToken: "irrelevante-aqui",
    refreshToken: "r",
    accessExp: exp,
  });
  // A folga existe para que uma requisição que chega no último suspiro do token
  // não seja atendida com um token que expira no meio dela.
  assert.equal(needsRefresh(com(agoraS + 600), agoraS), false);
  assert.equal(needsRefresh(com(agoraS + 30), agoraS), true);
  assert.equal(needsRefresh(com(agoraS - 1), agoraS), true);
});

test("aperto de mão expirado não é aceito", async () => {
  // Dez minutos é tempo de completar um login. Passado isso o pedido não existe
  // mais, e um cookie de handshake sobrevivente seria uma janela aberta.
  const vencido = await seal(
    {
      state: "s",
      nonce: "n",
      codeVerifier: "v",
      redirectUri: "https://app.exemplo.test/api/auth/callback",
      returnTo: "/",
      expiresAt: Date.now() - 1_000,
    },
    configA.clientSecret,
    "handshake",
  );
  assert.equal(await readHandshake(vencido, configA), null);
});
