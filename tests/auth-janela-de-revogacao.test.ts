// A janela de revogação: o que acontece entre alguém perder o acesso e o App
// parar de atendê-lo.
//
// A sessão carrega as permissões DENTRO do access token, e o token vive no
// máximo dez minutos. Isso é deliberado — a plataforma fica fora do caminho
// quente, e nenhuma chamada deste App vai perguntar a ela "esta pessoa ainda
// pode?". O preço é uma janela: revogar o acesso não interrompe uma sessão em
// curso, ela morre na renovação seguinte.
//
// O caso 1 aqui é essa janela, escrita como comportamento ACEITO em vez de
// deixada implícita. O caso 2 é o que a torna uma janela em vez de um
// vazamento: **na renovação, as permissões são recalculadas pelo provedor e a
// mesma chamada é recusada.** Sem o caso 2, quem perdeu o acesso continuaria
// entrando para sempre — e o sintoma seria ausência de erro, que é o defeito
// mais caro de descobrir.
//
// O caminho exercitado é o do `proxy.ts`, que é quem renova: `readSealedPayload`
// → `needsRefresh` → `refreshSession` → `sealSession` → e a rota lendo o cookie
// novo com `readSession`. O último caso deste arquivo fecha o circuito chamando
// o **`proxy()` de verdade** e pegando o cookie do cabeçalho `set-cookie` que ele
// emite — é o que prova que a renovação chega ao navegador, e não só à memória do
// teste.
//
// O provedor é de mentira, como em `tests/auth-session.test.ts`: mesmas chaves
// RSA forjadas na subida, mesma descoberta servida por um `fetch` trocado. O
// harness é repetido de propósito — cada teste deste scaffold roda sozinho, sem
// depender de um módulo de apoio que o runner não executa.
//
// Rodar: npm test
import assert from "node:assert/strict";
import { before, beforeEach, test } from "node:test";

import { NextRequest } from "next/server";

import { SESSION_COOKIE, type AuthConfig } from "../lib/auth/config";
import { base64UrlEncode, seal } from "../lib/auth/crypto";
import { resetDiscoveryCacheForTests } from "../lib/auth/discovery";
import type { PublicJwk } from "../lib/auth/jwt";
import {
  needsRefresh,
  readSealedPayload,
  readSession,
  refreshSession,
  sealSession,
  type Session,
  type SessionPayload,
} from "../lib/auth/session";
import { serviceRoute } from "../lib/http/service-route";
import { getTool } from "../lib/mcp/tools";
import { verDiagnostico } from "../lib/services/painel";
import { proxy } from "../proxy";

const ISSUER = "https://provedor.exemplo.test";
const APP_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const KID = "kid-1";
const PERMISSAO = "ver_diagnostico";

const config: AuthConfig = {
  issuer: ISSUER,
  clientId: "client-a",
  clientSecret: "segredo-do-app-a",
};

let privateKey: CryptoKey;
let jwks: { keys: PublicJwk[] };

/** O que o provedor concede AGORA. Revogar, aqui, é esvaziar esta lista. */
let concedidas: string[] = [PERMISSAO];
/** O refresh token continua valendo? O provedor derruba a família ao revogá-lo. */
let refreshValido = true;
/**
 * O refresh token que vale AGORA. O provedor rotaciona a cada uso e derruba a
 * família inteira se o anterior reaparecer — modelar isso é o que permite provar
 * a rotação em vez de descrevê-la.
 */
let refreshAtivo = "refresh-1";
let proximoRefresh = 2;
/** Idas ao token endpoint. O caminho quente não faz nenhuma. */
let chamadasAoTokenEndpoint = 0;
/** Todo caminho do provedor que o App visitou, para poder afirmar o que visitou. */
let caminhosVisitados: string[] = [];

const agora = () => Math.floor(Date.now() / 1000);

async function assinar(claims: Record<string, unknown>): Promise<string> {
  const encoder = new TextEncoder();
  const cabecalho = base64UrlEncode(
    encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT", kid: KID })),
  );
  const corpo = base64UrlEncode(encoder.encode(JSON.stringify(claims)));
  const assinatura = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    encoder.encode(`${cabecalho}.${corpo}`),
  );
  return `${cabecalho}.${corpo}.${base64UrlEncode(new Uint8Array(assinatura))}`;
}

/** Access token como o provedor emite: as permissões vão DENTRO dele. */
function accessToken(permissoes: string[], expEm: number): Promise<string> {
  return assinar({
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
    exp: expEm,
  });
}

/** Cookie selado, como o callback e o proxy escrevem. */
async function cookie(permissoes: string[], expEm: number): Promise<string> {
  const payload: SessionPayload = {
    accessToken: await accessToken(permissoes, expEm),
    refreshToken: "refresh-1",
    accessExp: expEm,
  };
  return seal(payload, config.clientSecret, "session");
}

before(async () => {
  // O `proxy()` lê a configuração de `process.env`, e não de um parâmetro: para
  // exercitá-lo é preciso montar o mesmo trio que a plataforma injeta.
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

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    caminhosVisitados.push(new URL(url).pathname);

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

    if (url.endsWith("/oauth/token")) {
      chamadasAoTokenEndpoint += 1;
      if (!refreshValido) {
        // Família derrubada: refresh expirado ou revogado.
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      }

      const apresentado = new URLSearchParams(String(init?.body ?? "")).get(
        "refresh_token",
      );
      if (apresentado !== refreshAtivo) {
        // Reapresentação do anterior: o provedor derruba a família INTEIRA, e não
        // só recusa esta tentativa. É o que impede um refresh copiado de render
        // sessão para sempre em paralelo à legítima.
        refreshValido = false;
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      }
      refreshAtivo = `refresh-${proximoRefresh}`;
      proximoRefresh += 1;

      // O provedor RECALCULA as permissões a cada emissão. É esta linha que
      // fecha a janela: o token novo reflete o que vale agora, não o que valia
      // quando a sessão começou.
      return Response.json({
        token_type: "Bearer",
        expires_in: 600,
        access_token: await accessToken(concedidas, agora() + 600),
        refresh_token: refreshAtivo,
      });
    }
    throw new Error(`fetch inesperado no teste: ${url}`);
  }) as typeof fetch;
});

beforeEach(() => {
  resetDiscoveryCacheForTests();
  concedidas = [PERMISSAO];
  refreshValido = true;
  refreshAtivo = "refresh-1";
  proximoRefresh = 2;
  chamadasAoTokenEndpoint = 0;
  caminhosVisitados = [];
});

/** As três portas da mesma decisão, exercitadas com a mesma sessão. */
async function tresPortas(session: Session | null) {
  const tool = getTool(PERMISSAO);
  assert.ok(tool, "a tool de exemplo precisa estar registrada");

  const rota = serviceRoute(verDiagnostico, {
    from: "query",
    readSession: async () => session,
  });

  return {
    servico: await verDiagnostico.execute(session, {}),
    tool: await tool.call(session, {}),
    rota: await rota(new Request("http://localhost:3000/api/diagnostico")),
  };
}

test("dentro da janela, a chamada revogada ainda passa — e nada é perguntado sobre a pessoa", async () => {
  // Token recém-emitido, com a permissão. Longe de expirar.
  const selado = await cookie([PERMISSAO], agora() + 600);

  // A permissão é revogada na plataforma NESTE instante.
  concedidas = [];

  const payload = await readSealedPayload(selado, config);
  assert.ok(payload);
  // Nada a renovar: o token está no meio da vida. É aqui que a janela existe.
  assert.equal(needsRefresh(payload, agora()), false);

  const session = await readSession(selado, config);
  assert.ok(session);
  assert.deepEqual(session.permissions, [PERMISSAO]);

  const portas = await tresPortas(session);
  assert.equal(portas.servico.ok, true, "o serviço ainda atende dentro da janela");
  assert.equal(portas.tool.ok, true, "a tool ainda atende dentro da janela");
  assert.equal(portas.rota.status, 200, "a rota ainda atende dentro da janela");

  // E o ponto que justifica a janela: nada disto PERGUNTOU ao provedor o que esta
  // pessoa pode. Não houve renovação...
  assert.equal(chamadasAoTokenEndpoint, 0, "não deveria ter renovado nada");
  // ...e o único tráfego para o provedor foi material PÚBLICO — descoberta e
  // chaves de assinatura, que não dependem de quem chama e ficam em cache. É
  // essa ausência de pergunta sobre a pessoa que a janela compra.
  assert.ok(caminhosVisitados.length > 0, "verificar o token exige as chaves");
  assert.deepEqual(
    caminhosVisitados.filter((caminho) => !caminho.startsWith("/.well-known/")),
    [],
    `houve tráfego específico da pessoa: ${JSON.stringify(caminhosVisitados)}`,
  );
});

test("na renovação, a permissão revogada deixa de valer nas três portas", async () => {
  // Token no fim da vida: é o estado em que o proxy renova.
  const selado = await cookie([PERMISSAO], agora() + 30);

  const payload = await readSealedPayload(selado, config);
  assert.ok(payload);
  assert.equal(
    needsRefresh(payload, agora()),
    true,
    "deveria estar na hora de renovar",
  );

  // Antes de renovar, ainda vale.
  const antes = await readSession(selado, config);
  assert.ok(antes);
  assert.deepEqual(antes.permissions, [PERMISSAO]);

  // A permissão é revogada, e a renovação acontece — o mesmo caminho do
  // `proxy.ts`: renova, sela de novo, e a requisição segue com o cookie novo.
  concedidas = [];
  const renovada = await refreshSession({
    config,
    refreshToken: payload.refreshToken,
  });
  const novoSelado = await sealSession(renovada, config);
  assert.equal(chamadasAoTokenEndpoint, 1);

  const depois = await readSession(novoSelado, config);
  assert.ok(depois, "a sessão continua existindo — o que mudou é o que ela pode");
  // Recálculo, não sessão nova: é a mesma pessoa, sem a permissão.
  assert.equal(depois.userId, antes.userId);
  assert.deepEqual(depois.permissions, []);

  const portas = await tresPortas(depois);
  assert.equal(portas.servico.ok, false);
  if (!portas.servico.ok) {
    assert.equal(portas.servico.error.code, "forbidden");
    assert.equal(portas.servico.error.permission, PERMISSAO);
  }
  assert.equal(portas.tool.ok, false, "a tool passa a recusar");
  assert.equal(portas.rota.status, 403, "a rota passa a recusar");
});

test("o cookie renovado é o que a próxima requisição lê", async () => {
  // Sem reselar, a renovação valeria só para a memória desta requisição e a
  // seguinte leria o token antigo — a permissão revogada voltaria a valer, e o
  // sintoma seria acesso intermitente.
  const selado = await cookie([PERMISSAO], agora() + 30);
  const payload = await readSealedPayload(selado, config);
  assert.ok(payload);

  concedidas = [];
  const novoSelado = await sealSession(
    await refreshSession({ config, refreshToken: payload.refreshToken }),
    config,
  );

  const relido = await readSealedPayload(novoSelado, config);
  assert.ok(relido);
  assert.notEqual(relido.accessToken, payload.accessToken);
  // O refresh também rotaciona — o token guardado é o novo, não o usado.
  assert.equal(relido.refreshToken, "refresh-2");
  assert.notEqual(relido.refreshToken, payload.refreshToken);

  const session = await readSession(novoSelado, config);
  assert.deepEqual(session?.permissions, []);
});

test("reapresentar o refresh anterior derruba a família inteira", async () => {
  // Por que a rotação importa, e por que não basta guardar o token novo: se o
  // anterior continuasse valendo, uma cópia dele renderia sessão em paralelo à
  // legítima, indefinidamente. O provedor recusa o reapresentado E derruba a
  // família — então o certo é NÃO guardar o antigo, que é o que `sealSession`
  // faz ao salvar só o payload novo.
  const selado = await cookie([PERMISSAO], agora() + 30);
  const payload = await readSealedPayload(selado, config);
  assert.ok(payload);

  const renovada = await refreshSession({
    config,
    refreshToken: payload.refreshToken,
  });
  assert.equal(renovada.refreshToken, "refresh-2");

  // O anterior, reapresentado, é recusado.
  await assert.rejects(
    () => refreshSession({ config, refreshToken: payload.refreshToken }),
    /token endpoint recusou/,
    "o refresh anterior deveria ter deixado de valer",
  );

  // E não é só esta tentativa: a família cai, então nem o token novo renova
  // mais. Quem trata isso é o `proxy.ts`, recusando a requisição — a sessão
  // acabou, e a pessoa entra de novo pelo login.
  await assert.rejects(
    () => refreshSession({ config, refreshToken: renovada.refreshToken }),
    /token endpoint recusou/,
    "a família deveria ter caído junto",
  );
});

test("refresh revogado encerra a sessão em vez de rebaixá-la", async () => {
  // A outra metade da revogação: derrubar o refresh token não deixa a pessoa com
  // menos permissão, deixa sem sessão. Quem trata isto é o `proxy.ts`, que
  // recusa a requisição e manda ao login.
  const selado = await cookie([PERMISSAO], agora() + 30);
  const payload = await readSealedPayload(selado, config);
  assert.ok(payload);

  refreshValido = false;
  await assert.rejects(
    () => refreshSession({ config, refreshToken: payload.refreshToken }),
    /token endpoint recusou/,
  );
});

test("token expirado não vira sessão, mesmo com assinatura boa", async () => {
  // O outro fim da janela: passado o `exp`, o token não vale nem para leitura.
  // Sem isto, um cliente que segurasse o mesmo access token para sempre
  // continuaria entrando — e é exatamente o que a janela de dez minutos existe
  // para impedir.
  const expirado = await cookie([PERMISSAO], agora() - 120);
  assert.equal(await readSession(expirado, config), null);
});

/** O valor do cookie de sessão dentro do `set-cookie` que a resposta carrega. */
function cookieDaResposta(res: Response): string | null {
  for (const bruto of res.headers.getSetCookie()) {
    if (!bruto.startsWith(`${SESSION_COOKIE}=`)) continue;
    const valor = bruto.slice(SESSION_COOKIE.length + 1).split(";")[0] ?? "";
    return valor === "" ? null : valor;
  }
  return null;
}

test("o proxy renova de verdade: o cookie novo sai no set-cookie e já vem sem a permissão", async () => {
  // Os casos acima exercitam as funções que o `proxy.ts` chama. Este chama o
  // proxy. É a diferença entre "a renovação funciona" e "a renovação CHEGA ao
  // navegador": sem o `set-cookie`, o token novo viveria só na memória daquela
  // requisição e a seguinte leria o antigo de novo.
  const selado = await cookie([PERMISSAO], agora() + 30);
  concedidas = [];

  const pedido = new NextRequest("http://localhost:3000/painel");
  pedido.cookies.set(SESSION_COOKIE, selado);
  const resposta = await proxy(pedido);

  // Não é recusa nem desvio para o login: a sessão continua válida, só mudou o
  // que ela pode.
  assert.equal(resposta.status, 200);
  assert.equal(resposta.headers.get("location"), null);

  const renovado = cookieDaResposta(resposta);
  assert.ok(renovado, "o proxy tinha de devolver o cookie renovado no set-cookie");
  assert.notEqual(renovado, selado, "o cookie devolvido é o novo, não o que entrou");

  // E o que o navegador vai mandar na próxima requisição já não tem a permissão.
  const session = await readSession(renovado, config);
  assert.ok(session);
  assert.deepEqual(session.permissions, []);

  const portas = await tresPortas(session);
  assert.equal(portas.servico.ok, false);
  assert.equal(portas.tool.ok, false);
  assert.equal(portas.rota.status, 403);
});

test("o proxy NÃO reemite cookie quando não há o que renovar", async () => {
  // O controle negativo do caso acima: sem ele, um `set-cookie` emitido em toda
  // requisição passaria por "renovação funcionando" — e a asserção de cima não
  // provaria nada sobre a janela.
  const selado = await cookie([PERMISSAO], agora() + 600);

  const pedido = new NextRequest("http://localhost:3000/painel");
  pedido.cookies.set(SESSION_COOKIE, selado);
  const resposta = await proxy(pedido);

  assert.equal(resposta.status, 200);
  assert.equal(cookieDaResposta(resposta), null, "não havia nada a renovar");
  assert.equal(chamadasAoTokenEndpoint, 0);
});
