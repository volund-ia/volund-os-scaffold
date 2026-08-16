// Verificação de token com chave e assinatura de verdade.
//
// O caso que dá nome a este arquivo: o JWKS é COMPARTILHADO por todos os Apps da
// plataforma. Um token emitido para outro App é assinado pela mesma chave e
// passa em qualquer verificação que olhe só a assinatura. O que o separa é a
// audiência — e é isso que está sendo exercitado aqui, com um token do App A
// sendo apresentado ao App B.
import assert from "node:assert/strict";
import { before, test } from "node:test";

import { base64UrlEncode } from "../lib/auth/crypto";
import type { PublicJwk } from "../lib/auth/jwt";
import { verifyAccessToken, verifyIdToken, verifySignedToken } from "../lib/auth/jwt";

const ISSUER = "https://os.volund.com.br";
const APP_A = "11111111-1111-1111-1111-111111111111";
const APP_B = "22222222-2222-2222-2222-222222222222";
const CLIENT_A = "client-do-app-a";
const CLIENT_B = "client-do-app-b";
const KID = "chave-de-teste";

let privateKey: CryptoKey;
let keys: PublicJwk[];

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
  keys = [{ kty: jwk.kty, n: jwk.n, e: jwk.e, kid: KID, alg: "RS256", use: "sig" }];
});

const agora = () => Math.floor(Date.now() / 1000);

async function assinar(
  claims: Record<string, unknown>,
  header: Record<string, unknown> = {},
): Promise<string> {
  const encoder = new TextEncoder();
  const cabecalho = base64UrlEncode(
    encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT", kid: KID, ...header })),
  );
  const corpo = base64UrlEncode(encoder.encode(JSON.stringify(claims)));
  const assinatura = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    encoder.encode(`${cabecalho}.${corpo}`),
  );
  return `${cabecalho}.${corpo}.${base64UrlEncode(new Uint8Array(assinatura))}`;
}

function accessTokenDe(
  appId: string,
  clientId: string,
  extra: Record<string, unknown> = {},
) {
  return assinar({
    iss: ISSUER,
    sub: "usuario-1",
    aud: `volund:app:${appId}`,
    azp: clientId,
    app_id: appId,
    org_id: "org-1",
    scope: "openid profile email volund.permissions",
    roles: [],
    permissions: [],
    iat: agora(),
    exp: agora() + 600,
    ...extra,
  });
}

test("access token do próprio App é aceito", async () => {
  const token = await accessTokenDe(APP_A, CLIENT_A);
  const r = await verifyAccessToken(token, {
    keys,
    issuer: ISSUER,
    appId: APP_A,
  });
  assert.equal(r.ok, true);
});

test("App B RECUSA um access token legítimo do App A", async () => {
  // O caso que dá nome ao arquivo. Mesma chave, mesma assinatura, emissor certo,
  // dentro da validade — e o que separa os dois é a AUDIÊNCIA, conferida contra
  // o `VOLUND_APP_ID` de quem verifica. Sem essa conferência isto entraria como
  // sessão válida no App B.
  const token = await accessTokenDe(APP_A, CLIENT_A);
  const r = await verifyAccessToken(token, {
    keys,
    issuer: ISSUER,
    appId: APP_B,
  });
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.reason : "", /outro App/);
});

test("cliente de MCP de FORA é aceito — vale para quem o token foi emitido", async () => {
  // O defeito que travou o BUG-113, virado teste. Um cliente que se registrou
  // sozinho no provedor (RFC 7591) obtém, com o consentimento da pessoa, um
  // token cuja audiência é este App — e cujo `azp` é dele, não nosso. Enquanto
  // esta função exigia `azp === client_id`, a resposta era 401 a um token
  // perfeitamente válido, e nenhum cliente de mercado falava com um App.
  const token = await accessTokenDe(APP_A, "volund_dcr_de_um_cliente_qualquer");
  const r = await verifyAccessToken(token, {
    keys,
    issuer: ISSUER,
    appId: APP_A,
  });
  assert.equal(r.ok, true);
  assert.equal(
    r.ok === true ? r.claims.azp : null,
    "volund_dcr_de_um_cliente_qualquer",
    "o `azp` continua legível: virou trilha de qual cliente entrou",
  );
});

test("audiência incoerente com o app_id é recusada — nos dois sentidos", async () => {
  // A coerência que a versão anterior FINGIA conferir: ela comparava `aud` com
  // o `app_id` do mesmo token, dois campos que o emissor escreve juntos. Agora
  // os dois saem da mesma referência externa, então divergir de qualquer um
  // recusa.

  // `app_id` deste App, audiência de outro.
  const audDeOutro = await accessTokenDe(APP_A, CLIENT_A, {
    aud: `volund:app:${APP_B}`,
  });
  const r1 = await verifyAccessToken(audDeOutro, {
    keys,
    issuer: ISSUER,
    appId: APP_A,
  });
  assert.equal(r1.ok, false);
  assert.match(r1.ok === false ? r1.reason : "", /audiência/);

  // Audiência deste App, `app_id` de outro. Aceitar faria a `Session` nascer com
  // o `appId` de outro App — o mapeamento de claims lê `app_id`, não a audiência.
  const appIdDeOutro = await accessTokenDe(APP_A, CLIENT_A, { app_id: APP_B });
  const r2 = await verifyAccessToken(appIdDeOutro, {
    keys,
    issuer: ISSUER,
    appId: APP_A,
  });
  assert.equal(r2.ok, false);
  assert.match(r2.ok === false ? r2.reason : "", /outro App/);
});

test("token expirado é recusado", async () => {
  const token = await accessTokenDe(APP_A, CLIENT_A, {
    iat: agora() - 7200,
    exp: agora() - 3600,
  });
  const r = await verifyAccessToken(token, {
    keys,
    issuer: ISSUER,
    appId: APP_A,
  });
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.reason : "", /expirado/);
});

test("emissor diferente do configurado é recusado", async () => {
  const token = await accessTokenDe(APP_A, CLIENT_A, {
    iss: "https://provedor-de-mentira.com",
  });
  const r = await verifyAccessToken(token, {
    keys,
    issuer: ISSUER,
    appId: APP_A,
  });
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.reason : "", /emissor/);
});

test("assinatura adulterada é recusada", async () => {
  const token = await accessTokenDe(APP_A, CLIENT_A);
  const [cabecalho, , assinatura] = token.split(".");
  const outroCorpo = base64UrlEncode(
    new TextEncoder().encode(
      JSON.stringify({
        iss: ISSUER,
        sub: "invasor",
        aud: `volund:app:${APP_A}`,
        azp: CLIENT_A,
        app_id: APP_A,
        iat: agora(),
        exp: agora() + 600,
      }),
    ),
  );
  const r = await verifyAccessToken(`${cabecalho}.${outroCorpo}.${assinatura}`, {
    keys,
    issuer: ISSUER,
    appId: APP_A,
  });
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.reason : "", /assinatura/);
});

test("`alg: none` é recusado — o token não escolhe o algoritmo", async () => {
  const encoder = new TextEncoder();
  const cabecalho = base64UrlEncode(
    encoder.encode(JSON.stringify({ alg: "none", typ: "JWT", kid: KID })),
  );
  const corpo = base64UrlEncode(
    encoder.encode(
      JSON.stringify({
        iss: ISSUER,
        sub: "invasor",
        aud: `volund:app:${APP_A}`,
        azp: CLIENT_A,
        app_id: APP_A,
        exp: agora() + 600,
      }),
    ),
  );
  const r = await verifyAccessToken(`${cabecalho}.${corpo}.`, {
    keys,
    issuer: ISSUER,
    appId: APP_A,
  });
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.reason : "", /algoritmo/);
});

test("token com kid desconhecido é recusado, e sem kid também", async () => {
  const comOutroKid = await assinar(
    { iss: ISSUER, sub: "u", aud: `volund:app:${APP_A}`, exp: agora() + 600 },
    { kid: "kid-que-nao-existe" },
  );
  const semKid = await assinar(
    { iss: ISSUER, sub: "u", aud: `volund:app:${APP_A}`, exp: agora() + 600 },
    { kid: undefined },
  );

  const r1 = await verifySignedToken(comOutroKid, { keys, issuer: ISSUER });
  assert.equal(r1.ok, false);
  const r2 = await verifySignedToken(semKid, { keys, issuer: ISSUER });
  assert.equal(r2.ok, false);
  assert.match(r2.ok === false ? r2.reason : "", /kid/);
});

test("ID token: audiência é o client_id, e o nonce tem que bater", async () => {
  const token = await assinar({
    iss: ISSUER,
    sub: "usuario-1",
    aud: CLIENT_A,
    app_id: APP_A,
    org_id: "org-1",
    nonce: "nonce-do-pedido",
    iat: agora(),
    exp: agora() + 600,
  });

  const bom = await verifyIdToken(token, {
    keys,
    issuer: ISSUER,
    clientId: CLIENT_A,
    nonce: "nonce-do-pedido",
  });
  assert.equal(bom.ok, true);

  const outroNonce = await verifyIdToken(token, {
    keys,
    issuer: ISSUER,
    clientId: CLIENT_A,
    nonce: "nonce-de-outro-pedido",
  });
  assert.equal(outroNonce.ok, false);

  const outroClient = await verifyIdToken(token, {
    keys,
    issuer: ISSUER,
    clientId: CLIENT_B,
    nonce: "nonce-do-pedido",
  });
  assert.equal(outroClient.ok, false);
});

test("token malformado não estoura exceção", async () => {
  for (const entrada of ["", "a.b", "a.b.c", "...."]) {
    const r = await verifyAccessToken(entrada, {
      keys,
      issuer: ISSUER,
      appId: APP_A,
    });
    assert.equal(r.ok, false);
  }
});
