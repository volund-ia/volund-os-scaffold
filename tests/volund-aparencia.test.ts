// A marca da organização (contrato 9): o App lê a aparência da plataforma e
// aplica no layout — e, quando não consegue, segue com o tema padrão.
//
// O que estes casos protegem, em uma frase cada:
//
//  - Falha de qualquer tipo (rede, status, formato) vira `null`, nunca exceção:
//    a marca está no layout de TODA página, e uma exceção ali derrubaria o App.
//  - `css` com `</` é recusado: ele entra cru num `<style>`, e `</style>` ali
//    dentro viraria HTML na origem do App.
//  - O endereço anunciado na descoberta vale — mas só na origem do emissor,
//    porque o pedido leva o segredo do App.
//
// Rodar: npm test
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { beforeEach, test } from "node:test";

import type { AuthConfig } from "../lib/auth/config";
import { resetDiscoveryCacheForTests } from "../lib/auth/discovery";
import {
  APP_APPEARANCE_PATH,
  appearanceEndpoint,
  loadAppAppearance,
  safeBrandCss,
} from "../lib/volund/appearance";

const ISSUER = "https://provedor.exemplo.test";

const config: AuthConfig = {
  issuer: ISSUER,
  clientId: "client-do-app",
  clientSecret: "seg:redo",
  appId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
};

const contrato = JSON.parse(
  readFileSync(new URL("../contracts/app-appearance.json", import.meta.url), "utf8"),
) as {
  contract: number;
  endpoint: { discoveryField: string; fallbackPath: string; method: string };
  response: { fields: string[]; css: { forbidden: string[] } };
};

const CSS =
  'html:root{--primary:oklch(0.6 0.2 250);--ring:oklch(0.6 0.2 250)}html:root[data-tema="claro"]{--primary:oklch(0.5 0.2 250)}';

function aparencia(extra: Record<string, unknown> = {}) {
  return {
    name: "Escritório Souza",
    logo_url: "https://cdn.exemplo.test/logo.png",
    icon_url: "https://cdn.exemplo.test/icone.png",
    primary_color: "#3355ff",
    avatar_bg_color: "#112244",
    css: CSS,
    ...extra,
  };
}

/** O que a descoberta anuncia agora (`undefined` = não anuncia). */
let anunciado: string | undefined;
/** O que o endpoint da marca faz agora. */
let marca: { status: number; body: unknown } | "cai" = {
  status: 200,
  body: aparencia(),
};
let pedidos: Array<{ url: string; authorization: string | null; method: string }> = [];

beforeEach(() => {
  resetDiscoveryCacheForTests();
  anunciado = undefined;
  marca = { status: 200, body: aparencia() };
  pedidos = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url === `${ISSUER}/.well-known/openid-configuration`) {
      return Response.json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/oauth/authorize`,
        token_endpoint: `${ISSUER}/oauth/token`,
        userinfo_endpoint: `${ISSUER}/oauth/userinfo`,
        jwks_uri: `${ISSUER}/oauth/jwks`,
        ...(anunciado ? { [contrato.endpoint.discoveryField]: anunciado } : {}),
      });
    }
    pedidos.push({
      url,
      method: init?.method ?? "GET",
      authorization: new Headers(init?.headers).get("authorization"),
    });
    if (marca === "cai") throw new TypeError("fetch failed");
    return Response.json(marca.body, { status: marca.status });
  }) as typeof fetch;
});

test("o contrato da marca anda com o número do scaffold", () => {
  const manifesto = JSON.parse(
    readFileSync(new URL("../volund-scaffold.json", import.meta.url), "utf8"),
  ) as { contract: number };
  assert.equal(contrato.contract, manifesto.contract);
  assert.equal(APP_APPEARANCE_PATH, contrato.endpoint.fallbackPath);
  assert.deepEqual(contrato.response.css.forbidden, ["</"]);
});

test("a marca chega traduzida, pedida com o segredo do App", async () => {
  const a = await loadAppAppearance(config);
  assert.deepEqual(a, {
    name: "Escritório Souza",
    logoUrl: "https://cdn.exemplo.test/logo.png",
    iconUrl: "https://cdn.exemplo.test/icone.png",
    primaryColor: "#3355ff",
    avatarBgColor: "#112244",
    css: CSS,
  });
  assert.deepEqual(Object.keys(aparencia()), contrato.response.fields);

  const [p] = pedidos;
  assert.ok(p);
  assert.equal(p.method, contrato.endpoint.method);
  assert.equal(p.url, `${ISSUER}${contrato.endpoint.fallbackPath}`);
  // client_secret_basic, com o mesmo percent-encoding do token endpoint.
  const [tipo, valor] = (p.authorization ?? "").split(" ");
  assert.equal(tipo, "Basic");
  const [id, segredo] = Buffer.from(valor ?? "", "base64")
    .toString("utf8")
    .split(":");
  assert.equal(decodeURIComponent(id ?? ""), config.clientId);
  assert.equal(decodeURIComponent(segredo ?? ""), config.clientSecret);
});

test("o endereço anunciado na descoberta vale, se for do próprio emissor", async () => {
  anunciado = `${ISSUER}/oauth/outra-aparencia`;
  assert.equal(await appearanceEndpoint(config), anunciado);
  await loadAppAppearance(config);
  assert.equal(pedidos.at(-1)?.url, anunciado);
});

test("e é ignorado se apontar para outro host — o pedido leva o segredo", async () => {
  anunciado = "https://intruso.exemplo.test/oauth/app-appearance";
  assert.equal(await appearanceEndpoint(config), `${ISSUER}${APP_APPEARANCE_PATH}`);
  await loadAppAppearance(config);
  assert.ok(pedidos.every((p) => !p.url.startsWith("https://intruso.")));
});

test("falha da plataforma é tema padrão, sem exceção", async (t) => {
  t.mock.method(console, "error", () => {});
  marca = "cai";
  assert.equal(await loadAppAppearance(config), null);
  marca = { status: 503, body: {} };
  assert.equal(await loadAppAppearance(config), null);
  marca = { status: 200, body: "não é objeto" };
  assert.equal(await loadAppAppearance(config), null);
  // Sem configuração (o `next build` sem as variáveis): também tema padrão.
  const semEnv = process.env.VOLUND_OIDC_ISSUER;
  delete process.env.VOLUND_OIDC_ISSUER;
  try {
    assert.equal(await loadAppAppearance(), null);
  } finally {
    if (semEnv !== undefined) process.env.VOLUND_OIDC_ISSUER = semEnv;
  }
});

test("css com `</` é recusado, e o resto da marca continua", async (t) => {
  t.mock.method(console, "error", () => {});
  const malicioso = `${CSS}</style><script>alert(1)</script><style>`;
  assert.equal(safeBrandCss(malicioso), null);
  assert.equal(safeBrandCss("html:root{--primary:red}</STYLE>"), null);

  marca = { status: 200, body: aparencia({ css: malicioso }) };
  const a = await loadAppAppearance(config);
  assert.ok(a, "a marca inteira não deveria cair por causa do css");
  assert.equal(a.css, null);
  // O caso está ARMADO: o logo e o nome chegam, e o mesmo css sem `</` passa.
  assert.equal(a.name, "Escritório Souza");
  assert.equal(safeBrandCss(CSS), CSS);
});

test("css que não é texto, ou vazio, também fica de fora", () => {
  assert.equal(safeBrandCss(null), null);
  assert.equal(safeBrandCss(42), null);
  assert.equal(safeBrandCss({ "--primary": "red" }), null);
  assert.equal(safeBrandCss("   "), null);
});

test("ícone e logo só como endereço http(s)", async () => {
  marca = {
    status: 200,
    body: aparencia({
      logo_url: "javascript:alert(1)",
      icon_url: "data:image/png;base64,AA",
    }),
  };
  const a = await loadAppAppearance(config);
  assert.ok(a);
  assert.equal(a.logoUrl, null);
  assert.equal(a.iconUrl, null);
});

test("o layout injeta o css conferido e o ícone da organização", () => {
  const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.match(
    layout,
    /<style\s+id="volund-marca"\s+dangerouslySetInnerHTML=\{\{\s*__html:\s*appearance\.css\s*\}\}\s*\/>/,
  );
  assert.match(layout, /icons: \{ icon: appearance\.iconUrl \}/);
  // Do `orgAppearance`, que passa por `safeBrandCss` — nunca de um fetch próprio.
  assert.match(layout, /await orgAppearance\(\)/);
  assert.doesNotMatch(layout, /fetch\(/);
});
