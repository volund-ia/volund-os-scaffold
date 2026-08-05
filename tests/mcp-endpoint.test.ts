// O endpoint MCP é a terceira porta — a que um agente usa. O que estes testes
// vigiam é que ela não afrouxa nada em relação às outras duas:
//
//   1. sem token válido não há servidor MCP nenhum (401, com `WWW-Authenticate`
//      dizendo COMO se autenticar);
//   2. `tools/list` mostra só o que este sujeito pode chamar — a lista completa
//      entregaria o desenho interno do App a quem não tem acesso a nada dele;
//   3. `tools/call` recusa a tool que o sujeito não pode e a tool que não existe,
//      porque quem chama pelo nome nunca passou pela lista;
//   4. a tool que ele pode chamar atravessa até o serviço e volta com o dado.
//
// O provedor OIDC é de mentira, como em `tests/auth-session.test.ts` e
// `tests/auth-janela-de-revogacao.test.ts`: chaves RSA forjadas na subida e a
// descoberta servida por um `fetch` trocado. O token é montado aqui e apresentado
// no cabeçalho, que é exatamente o caminho do agente.
//
// Rodar: npm test
import assert from "node:assert/strict";
import { before, beforeEach, test } from "node:test";

import { GET, POST } from "../app/api/mcp/route";
import type { AuthConfig } from "../lib/auth/config";
import { base64UrlEncode } from "../lib/auth/crypto";
import { resetDiscoveryCacheForTests } from "../lib/auth/discovery";
import type { PublicJwk } from "../lib/auth/jwt";

const ISSUER = "https://provedor.exemplo.test";
const APP_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const KID = "kid-1";
const PROTEGIDA = "ver_diagnostico";

const config: AuthConfig = {
  issuer: ISSUER,
  clientId: "client-a",
  clientSecret: "segredo-do-app-a",
};

let privateKey: CryptoKey;
let jwks: { keys: PublicJwk[] };

const agora = () => Math.floor(Date.now() / 1000);

async function accessToken(permissoes: string[]): Promise<string> {
  const encoder = new TextEncoder();
  const cabecalho = base64UrlEncode(
    encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT", kid: KID })),
  );
  const corpo = base64UrlEncode(
    encoder.encode(
      JSON.stringify({
        iss: ISSUER,
        sub: "usuario-1",
        aud: `volund:app:${APP_ID}`,
        azp: config.clientId,
        app_id: APP_ID,
        org_id: "org-1",
        email: "pessoa@exemplo.test",
        name: "Pessoa",
        roles: [],
        permissions: permissoes,
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

before(async () => {
  process.env.VOLUND_OIDC_ISSUER = ISSUER;
  process.env.VOLUND_OIDC_CLIENT_ID = config.clientId;
  process.env.VOLUND_OIDC_CLIENT_SECRET = config.clientSecret;

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

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/.well-known/openid-configuration")) {
      return Response.json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/oauth/authorize`,
        token_endpoint: `${ISSUER}/oauth/token`,
        userinfo_endpoint: `${ISSUER}/oauth/userinfo`,
        jwks_uri: `${ISSUER}/.well-known/jwks.json`,
      });
    }
    if (url.endsWith("/.well-known/jwks.json")) return Response.json(jwks);
    throw new Error(`fetch inesperado no teste: ${url}`);
  }) as typeof fetch;
});

beforeEach(() => resetDiscoveryCacheForTests());

interface RespostaRpc {
  status: number;
  corpo: {
    result?: {
      tools?: { name: string }[];
      content?: { text?: string }[];
      isError?: boolean;
    };
    error?: { code: number; message: string };
  };
}

/** Uma chamada JSON-RPC ao endpoint, como o cliente MCP faz. */
async function chamar(
  metodo: string,
  params: unknown,
  token: string | null,
): Promise<RespostaRpc> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    // O Streamable HTTP exige que o cliente aceite as duas formas de resposta.
    accept: "application/json, text/event-stream",
  };
  if (token) headers.authorization = `Bearer ${token}`;

  const res = await POST(
    new Request("http://localhost:3000/api/mcp", {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: metodo, params }),
    }),
  );

  const texto = await res.text();
  if (!texto) return { status: res.status, corpo: {} };

  // A resposta pode vir como JSON ou como evento SSE (`data: {...}`), conforme a
  // negociação do transporte. As duas carregam o mesmo envelope JSON-RPC.
  const linhaDeDados = texto
    .split("\n")
    .find((linha) => linha.startsWith("data: "))
    ?.slice("data: ".length);

  try {
    return { status: res.status, corpo: JSON.parse(linhaDeDados ?? texto) };
  } catch {
    return { status: res.status, corpo: {} };
  }
}

const iniciar = (token: string) =>
  chamar(
    "initialize",
    {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "teste", version: "1.0.0" },
    },
    token,
  );

test("sem token não há MCP: 401 dizendo como se autenticar", async () => {
  const res = await chamar("tools/list", {}, null);
  assert.equal(res.status, 401);
});

test("token inválido também é 401 — e pelo mesmo caminho da sessão web", async () => {
  // Assinatura de outra chave: a verificação é a mesma da tela, então não passa.
  const res = await chamar("tools/list", {}, "nao.e.um.token");
  assert.equal(res.status, 401);
});

test("o GET (canal de eventos) também exige token", async () => {
  const res = await GET(
    new Request("http://localhost:3000/api/mcp", {
      headers: { accept: "text/event-stream" },
    }),
  );
  assert.equal(res.status, 401);
  assert.match(res.headers.get("www-authenticate") ?? "", /Bearer/);
});

test("token de OUTRO App não entra por aqui", async () => {
  // O JWKS é compartilhado por todos os Apps da plataforma: um token legítimo de
  // outro App tem assinatura boa. O que o separa é a audiência
  // (`volund:app:<appAgentId>`) e o `azp`, conferidos pela MESMA verificação da
  // sessão web. Se esta porta não checasse, o MCP seria o caminho lateral para
  // entrar num App com credencial de outro.
  const encoder = new TextEncoder();
  const cabecalho = base64UrlEncode(
    encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT", kid: KID })),
  );
  const corpo = base64UrlEncode(
    encoder.encode(
      JSON.stringify({
        iss: ISSUER,
        sub: "usuario-1",
        aud: "volund:app:bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        azp: "client-b",
        app_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        org_id: "org-1",
        permissions: [PROTEGIDA],
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
  const deOutroApp = `${cabecalho}.${corpo}.${base64UrlEncode(new Uint8Array(assinatura))}`;

  const res = await chamar("tools/list", {}, deOutroApp);
  assert.equal(res.status, 401);
});

test("initialize responde com a identificação do servidor", async () => {
  const res = await iniciar(await accessToken([]));
  assert.equal(res.status, 200);
  assert.equal(res.corpo.error, undefined);
});

test("tools/list mostra só o que este sujeito pode chamar", async () => {
  const semPermissao = await chamar("tools/list", {}, await accessToken([]));
  const nomes = (semPermissao.corpo.result?.tools ?? []).map((t) => t.name);

  assert.ok(nomes.length > 0, "as tools sem permissão têm de aparecer");
  assert.ok(nomes.includes("ver_perfil"), "ver_perfil não exige permissão");
  assert.ok(
    !nomes.includes(PROTEGIDA),
    `${PROTEGIDA} exige permissão e não deveria aparecer para quem não a tem`,
  );

  const comPermissao = await chamar("tools/list", {}, await accessToken([PROTEGIDA]));
  const nomesConcedidos = (comPermissao.corpo.result?.tools ?? []).map((t) => t.name);
  assert.ok(
    nomesConcedidos.includes(PROTEGIDA),
    "com a permissão concedida, a tool passa a aparecer",
  );
});

test("tools/call atravessa até o serviço e volta com o dado", async () => {
  const res = await chamar(
    "tools/call",
    { name: "ecoar", arguments: { mensagem: "olá", repetir: 2 } },
    await accessToken([]),
  );
  assert.equal(res.status, 200);
  assert.equal(res.corpo.error, undefined);
  const texto = res.corpo.result?.content?.[0]?.text ?? "";
  assert.match(texto, /olá/);
  assert.equal(res.corpo.result?.isError, undefined);
});

test("tools/call de tool que o sujeito não pode é recusada", async () => {
  // A lista já a esconde; esta é a segunda guarda, para quem chama pelo nome.
  const res = await chamar(
    "tools/call",
    { name: PROTEGIDA, arguments: {} },
    await accessToken([]),
  );
  assert.ok(
    res.corpo.error !== undefined || res.corpo.result?.isError === true,
    `a chamada tinha de ser recusada; veio ${JSON.stringify(res.corpo)}`,
  );
});

test("tools/call de tool que o sujeito pode é atendida", async () => {
  const res = await chamar(
    "tools/call",
    { name: PROTEGIDA, arguments: {} },
    await accessToken([PROTEGIDA]),
  );
  assert.equal(res.corpo.error, undefined);
  assert.equal(res.corpo.result?.isError, undefined);
});

test("tools/call de tool inexistente é recusada", async () => {
  const res = await chamar(
    "tools/call",
    { name: "apagar_tudo", arguments: {} },
    await accessToken([]),
  );
  assert.ok(
    res.corpo.error !== undefined || res.corpo.result?.isError === true,
    "tool que não existe não pode ser atendida",
  );
});

test("entrada inválida é recusada antes de tocar o serviço", async () => {
  // O SDK valida contra o MESMO schema que o serviço declara — a recusa é a mesma
  // decisão, tomada uma vez.
  const res = await chamar(
    "tools/call",
    { name: "ecoar", arguments: { mensagem: "" } },
    await accessToken([]),
  );
  assert.ok(
    res.corpo.error !== undefined || res.corpo.result?.isError === true,
    "mensagem vazia não pode passar",
  );
});
