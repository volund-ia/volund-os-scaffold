// A sessão do chat embutido do VolundOS em modo pessoa (contrato 9).
//
// O que estes casos protegem, em uma frase cada:
//
//  - O pedido é conferido contra `contracts/agent-channel.json` (`embedSession`),
//    e não contra literais repetidos aqui: caminho, método, Bearer da TROCA,
//    `cache: "no-store"` e os nomes do corpo.
//  - O corpo leva só o que foi pedido, com os nomes da plataforma
//    (`thread_id`, `color_mode`...) — e não os do código (`threadId`).
//  - As recusas nomeadas viram motivo próprio; as que são defeito deste lado
//    viram indisponibilidade.
//  - Um `embed_url` fora da origem do emissor é recusado: o quadro só abre o
//    VolundOS.
//  - Os nomes das mensagens do quadro são os do contrato (os da plataforma).
//
// O provedor é de mentira, com `globalThis.fetch` trocado — mesmo harness de
// `tests/volund-canal-do-agente.test.ts`, repetido de propósito: cada teste
// deste scaffold roda sozinho.
//
// Rodar: npm test
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { beforeEach, test } from "node:test";

import type { AuthConfig } from "../lib/auth/config";
import { base64UrlEncode } from "../lib/auth/crypto";
import { resetDiscoveryCacheForTests } from "../lib/auth/discovery";
import type { Session } from "../lib/auth/session";
import {
  AgentChannelError,
  resetAgentChannelCacheForTests,
} from "../lib/volund/agents";
import {
  EMBED_SESSIONS_PATH,
  EMBED_TTL_MAX_SECONDS,
  EMBED_TTL_MIN_SECONDS,
  createEmbedSession,
  embedSessionOptionsSchema,
  revokeEmbedSession,
} from "../lib/volund/embed";
import { EMBED_EVENTS, readEmbedEvent, threadIdOf } from "../lib/volund/embed-messages";

const ISSUER = "https://provedor.exemplo.test";
const APP_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const THREAD = "3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c";

const config: AuthConfig = {
  issuer: ISSUER,
  clientId: "client-do-app",
  clientSecret: "segredo",
  appId: APP_ID,
};

const contrato = JSON.parse(
  readFileSync(new URL("../contracts/agent-channel.json", import.meta.url), "utf8"),
) as {
  contract: number;
  embedSession: {
    authentication: string;
    create: {
      method: string;
      path: string;
      contentType: string;
      cache: string;
      bodyFields: string[];
      enums: { color_mode: string[]; locale: string[] };
      ttlSeconds: { min: number; max: number };
      successStatus: number;
      responseFields: string[];
    };
    revoke: { method: string; path: string; successStatus: number };
    errors: Record<string, { status: number }>;
    messages: { fromFrame: string[]; toFrame: Record<string, unknown> };
  };
};
const embed = contrato.embedSession;

function sessao(userId: string, accessToken: string): Session {
  return {
    userId,
    orgId: "org-1",
    appId: APP_ID,
    email: null,
    name: null,
    roles: [],
    permissions: [],
    accessToken,
  };
}

function tokenComExp(exp: number): string {
  const parte = (o: unknown) =>
    base64UrlEncode(new TextEncoder().encode(JSON.stringify(o)));
  return `${parte({ alg: "none" })}.${parte({ exp })}.assinatura`;
}

const TOKEN_TROCADO = tokenComExp(Math.floor(Date.now() / 1000) + 600);

interface Pedido {
  url: string;
  method: string;
  headers: Headers;
  cache: RequestCache | undefined;
  body: unknown;
}

let pedidos: Pedido[] = [];
let resposta: { status: number; body: unknown } = { status: 201, body: {} };

function respostaBoa(extra: Record<string, unknown> = {}) {
  return {
    status: embed.create.successStatus,
    body: {
      session_id: "sessao-1",
      embed_url: `${ISSUER}/embed/c/sessao-1#code=abc`,
      expires_at: "2026-10-30T12:00:00.000Z",
      thread_id: THREAD,
      ...extra,
    },
  };
}

beforeEach(() => {
  resetDiscoveryCacheForTests();
  resetAgentChannelCacheForTests();
  pedidos = [];
  resposta = respostaBoa();

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();

    if (url === `${ISSUER}/.well-known/openid-configuration`) {
      return Response.json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/oauth/authorize`,
        token_endpoint: `${ISSUER}/oauth/token`,
        userinfo_endpoint: `${ISSUER}/oauth/userinfo`,
        jwks_uri: `${ISSUER}/oauth/jwks`,
      });
    }
    if (url === `${ISSUER}/oauth/token`) {
      return Response.json({ access_token: TOKEN_TROCADO, expires_in: 600 });
    }
    if (url.startsWith(`${ISSUER}${EMBED_SESSIONS_PATH}`)) {
      pedidos.push({
        url,
        method: init?.method ?? "GET",
        headers: new Headers(init?.headers),
        cache: init?.cache,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (resposta.status === 204) return new Response(null, { status: 204 });
      return Response.json(resposta.body, { status: resposta.status });
    }
    throw new Error(`fetch inesperado: ${url}`);
  }) as typeof fetch;
});

function pedido(i: number): Pedido {
  const p = pedidos[i];
  assert.ok(p, `esperava um pedido de sessão na posição ${i}`);
  return p;
}

async function falha(p: Promise<unknown>): Promise<AgentChannelError> {
  const erro = await p.then(
    () => null,
    (e: unknown) => e,
  );
  assert.ok(erro instanceof AgentChannelError, "esperava AgentChannelError");
  return erro;
}

test("o pedido de sessão bate com o contrato `embedSession`", async () => {
  await createEmbedSession(
    sessao("pessoa-1", "token-da-sessao"),
    {
      agent: "suporte",
      threadId: THREAD,
      colorMode: "light",
      locale: "pt-BR",
      ttlSeconds: 3600,
    },
    config,
  );

  const p = pedido(0);
  assert.equal(p.url, `${ISSUER}${embed.create.path}`);
  assert.equal(EMBED_SESSIONS_PATH, embed.create.path);
  assert.equal(p.method, embed.create.method);
  assert.equal(p.headers.get("content-type"), embed.create.contentType);
  assert.equal(p.cache, embed.create.cache);

  // Bearer com o token da TROCA — não o da sessão do App, que a plataforma
  // recusaria (`not_an_app_token`) e que, se aceito, não diria "através deste App".
  assert.equal(embed.authentication, "Bearer <token da troca>");
  assert.equal(p.headers.get("authorization"), `Bearer ${TOKEN_TROCADO}`);
  assert.notEqual(p.headers.get("authorization"), "Bearer token-da-sessao");

  // Os nomes da plataforma, exatamente os do contrato.
  assert.deepEqual(p.body, {
    agent: "suporte",
    thread_id: THREAD,
    color_mode: "light",
    locale: "pt-BR",
    ttl_seconds: 3600,
  });
  assert.deepEqual(
    Object.keys(p.body as object).sort(),
    [...embed.create.bodyFields].sort(),
  );
});

test("o corpo leva só o que foi pedido", async () => {
  await createEmbedSession(sessao("pessoa-1", "t"), {}, config);
  // Sem agente o padrão do App vale do lado de lá; mandar `agent: null` seria
  // pedir um agente chamado "null".
  assert.deepEqual(pedido(0).body, {});

  await createEmbedSession(sessao("pessoa-1", "t"), { agent: "cobranca" }, config);
  assert.deepEqual(pedido(1).body, { agent: "cobranca" });
});

test("a resposta chega traduzida, e com o endereço do quadro intacto", async () => {
  const s = await createEmbedSession(sessao("pessoa-1", "t"), {}, config);
  assert.deepEqual(s, {
    sessionId: "sessao-1",
    embedUrl: `${ISSUER}/embed/c/sessao-1#code=abc`,
    expiresAt: "2026-10-30T12:00:00.000Z",
    threadId: THREAD,
  });
  // O código de entrada mora no fragmento: perdê-lo na tradução abriria um
  // quadro que não entra.
  assert.ok(new URL(s.embedUrl).hash.startsWith("#code="));
  assert.deepEqual(Object.keys(respostaBoa().body), embed.create.responseFields);
});

test("os limites do que a tela pode pedir são os do contrato", () => {
  assert.equal(EMBED_TTL_MIN_SECONDS, embed.create.ttlSeconds.min);
  assert.equal(EMBED_TTL_MAX_SECONDS, embed.create.ttlSeconds.max);
  const ok = (v: unknown) => embedSessionOptionsSchema.safeParse(v).success;
  assert.equal(ok({ ttlSeconds: embed.create.ttlSeconds.min }), true);
  assert.equal(ok({ ttlSeconds: embed.create.ttlSeconds.min - 1 }), false);
  assert.equal(ok({ ttlSeconds: embed.create.ttlSeconds.max + 1 }), false);
  for (const m of embed.create.enums.color_mode)
    assert.equal(ok({ colorMode: m }), true);
  assert.equal(ok({ colorMode: "sepia" }), false);
  for (const l of embed.create.enums.locale) assert.equal(ok({ locale: l }), true);
  assert.equal(ok({ locale: "fr" }), false);
  assert.equal(ok({ threadId: THREAD }), true);
  assert.equal(ok({ threadId: "nao-e-uuid" }), false);
});

test("embed_url fora da origem do emissor é recusado", async (t) => {
  t.mock.method(console, "error", () => {});
  resposta = respostaBoa({
    embed_url: "https://outro.exemplo.test/embed/c/sessao-1#code=abc",
  });
  const erro = await falha(createEmbedSession(sessao("pessoa-1", "t"), {}, config));
  assert.equal(erro.code, "indisponivel");

  // O caso está ARMADO: o mesmo endereço na origem certa passa (teste acima).
  resposta = respostaBoa({ embed_url: "/embed/c/sessao-1#code=abc" });
  assert.equal(
    (await falha(createEmbedSession(sessao("pessoa-1", "t"), {}, config))).code,
    "indisponivel",
  );
});

test("as recusas nomeadas viram motivo próprio", async (t) => {
  t.mock.method(console, "error", () => {});
  const casos: Array<[string, string]> = [
    ["agent_not_found", "agente_desconhecido"],
    ["thread_not_found", "conversa_desconhecida"],
    ["not_an_app_token", "indisponivel"],
    ["invalid_request", "indisponivel"],
  ];
  for (const [codigo, motivo] of casos) {
    const def = embed.errors[codigo];
    assert.ok(def, `o contrato não descreve ${codigo}`);
    resposta = { status: def.status, body: { error: codigo, message: "x" } };
    const erro = await falha(createEmbedSession(sessao("pessoa-1", "t"), {}, config));
    assert.equal(erro.code, motivo, codigo);
  }
  assert.deepEqual(Object.keys(embed.errors).sort(), casos.map(([c]) => c).sort());
});

test("resposta 201 em formato inesperado é indisponibilidade, não sessão sem endereço", async (t) => {
  t.mock.method(console, "error", () => {});
  resposta = { status: 201, body: { session_id: "s" } };
  assert.equal(
    (await falha(createEmbedSession(sessao("pessoa-1", "t"), {}, config))).code,
    "indisponivel",
  );
});

test("encerrar a sessão é DELETE no caminho do contrato, com o token trocado", async () => {
  resposta = { status: embed.revoke.successStatus, body: null };
  assert.equal(
    await revokeEmbedSession(sessao("pessoa-1", "t"), "sessao 1/x", config),
    true,
  );
  const p = pedido(0);
  assert.equal(p.method, embed.revoke.method);
  assert.equal(
    p.url,
    `${ISSUER}${embed.revoke.path.replace("{session_id}", encodeURIComponent("sessao 1/x"))}`,
  );
  assert.equal(p.headers.get("authorization"), `Bearer ${TOKEN_TROCADO}`);
});

test("encerrar nunca lança, e diz quando não conseguiu", async (t) => {
  t.mock.method(console, "error", () => {});
  resposta = { status: 500, body: {} };
  assert.equal(await revokeEmbedSession(sessao("pessoa-1", "t"), "s", config), false);
});

test("os nomes das mensagens do quadro são os do contrato", () => {
  assert.deepEqual([...EMBED_EVENTS], embed.messages.fromFrame);
  assert.deepEqual(Object.keys(embed.messages.toFrame), [
    "volund:set-color-mode",
    "volund:send",
    "volund:new-thread",
  ]);
});

test("mensagem do quadro só vale da origem do VolundOS e da janela do próprio quadro", () => {
  const quadro = { nome: "o quadro" };
  const outro = { nome: "outra janela" };
  const ready = { type: "volund:ready", thread_id: THREAD };

  const lido = readEmbedEvent(
    { origin: ISSUER, source: quadro, data: ready },
    ISSUER,
    quadro,
  );
  assert.ok(lido);
  assert.equal(lido.type, "volund:ready");
  assert.equal(threadIdOf(lido), THREAD);

  assert.equal(
    readEmbedEvent(
      { origin: "https://intruso.test", source: quadro, data: ready },
      ISSUER,
      quadro,
    ),
    null,
  );
  assert.equal(
    readEmbedEvent({ origin: ISSUER, source: outro, data: ready }, ISSUER, quadro),
    null,
  );
  // Quadro ainda sem janela (desmontado): nada é aceito, nem de `source` nulo.
  assert.equal(
    readEmbedEvent({ origin: ISSUER, source: null, data: ready }, ISSUER, null),
    null,
  );
  assert.equal(
    readEmbedEvent(
      { origin: ISSUER, source: quadro, data: { type: "volund:inventado" } },
      ISSUER,
      quadro,
    ),
    null,
  );
});

test("o componente posta para a origem exata e troca o tema no `ready`", () => {
  const fonte = readFileSync(
    new URL("../components/volund/agent-embed.tsx", import.meta.url),
    "utf8",
  );
  assert.match(fonte, /postMessage\(command, platformOrigin\)/);
  assert.doesNotMatch(fonte, /postMessage\([^)]*["']\*["']\)/);
  assert.match(fonte, /case "volund:ready":[\s\S]*?type: "volund:set-color-mode"/);
  assert.match(fonte, /case "volund:session-expiring":[\s\S]*?renovar\(\)/);
  assert.match(
    fonte,
    /readEmbedEvent\(\s*event,\s*platformOrigin,\s*frameRef\.current\?\.contentWindow,?\s*\)/,
  );
});
