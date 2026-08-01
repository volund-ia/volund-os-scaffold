// PKCE e o selo do cookie. São as duas peças que, se estiverem erradas, não
// aparecem como erro: o login continua funcionando e a sessão continua sendo
// aceita — só que por quem não deveria.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  base64UrlEncode,
  codeChallengeS256,
  randomToken,
  seal,
  unseal,
} from "../lib/auth/crypto";

test("code_challenge S256 bate com o vetor da RFC 7636", async () => {
  // Apêndice B da RFC: o verifier e o desafio esperado. Um erro de base64url
  // (padding, `+/` no lugar de `-_`) passaria em qualquer teste de ida e volta
  // e só apareceria como `invalid_grant` do provedor.
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  assert.equal(
    await codeChallengeS256(verifier),
    "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  );
});

test("base64url não usa preenchimento nem caractere de URL", () => {
  const encoded = base64UrlEncode(new Uint8Array([251, 255, 190, 0]));
  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
});

test("valores aleatórios não se repetem", () => {
  const amostra = new Set(Array.from({ length: 50 }, () => randomToken()));
  assert.equal(amostra.size, 50);
});

const SEGREDO = "segredo-de-teste-nao-e-credencial";

test("o selo vai e volta", async () => {
  const selado = await seal({ userId: "u1", n: 7 }, SEGREDO, "session");
  assert.deepEqual(await unseal(selado, SEGREDO, "session"), { userId: "u1", n: 7 });
});

test("selo adulterado não abre", async () => {
  const selado = await seal({ userId: "u1" }, SEGREDO, "session");
  // Troca um byte do texto cifrado. Sem a tag de integridade do AES-GCM, isso
  // devolveria lixo em vez de recusar — e lixo vira sessão de alguém.
  const [versao, iv, cifrado = ""] = selado.split(".");
  const alterado = `${versao}.${iv}.${cifrado.slice(0, -2)}${cifrado.endsWith("aa") ? "bb" : "aa"}`;
  assert.equal(await unseal(alterado, SEGREDO, "session"), null);
});

test("selo de outro segredo não abre", async () => {
  const selado = await seal({ userId: "u1" }, SEGREDO, "session");
  assert.equal(await unseal(selado, "outro-segredo", "session"), null);
});

test("selo de outra finalidade não abre", async () => {
  // Sem separar as chaves por finalidade, um cookie de aperto de mão válido
  // poderia ser apresentado como cookie de sessão.
  const selado = await seal({ state: "x" }, SEGREDO, "handshake");
  assert.equal(await unseal(selado, SEGREDO, "session"), null);
});

test("entrada inválida devolve null em vez de estourar", async () => {
  for (const entrada of [undefined, null, "", "nada", "v9.aa.bb", "v1.só-uma-parte"]) {
    assert.equal(await unseal(entrada, SEGREDO, "session"), null);
  }
});
