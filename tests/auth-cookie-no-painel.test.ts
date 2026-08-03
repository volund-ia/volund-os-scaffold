// Os atributos dos cookies de autenticação — e por que o painel os decide.
//
// O App roda em dois lugares: numa aba, como qualquer site, e DENTRO do painel
// do VolundOS, num iframe entre sites. O segundo é o que manda aqui.
//
// Medido em 03/08/2026, com o cookie ainda em `SameSite=Lax`: dentro do painel o
// login começava, o provedor devolvia o `code`, e o callback respondia `400` —
// "pedido de login não encontrado ou expirado". O navegador não guarda nem
// devolve cookie `Lax` em contexto de terceiro, então o aperto de mão sumia
// entre a ida e a volta. Na aba, o mesmo App entrava sem problema.
//
// Rodar: npm test
import assert from "node:assert/strict";
import { test } from "node:test";

import { clearedCookie, handshakeCookie, sessionCookie } from "../lib/auth/session";

const HTTPS = "https://app.exemplo.com/qualquer";
const LOCAL = "http://localhost:3000/qualquer";

/** Os atributos, em minúsculas, para comparar sem depender de caixa. */
const attrs = (cookie: string): string[] =>
  cookie
    .split(";")
    .slice(1)
    .map((p) => p.trim().toLowerCase());

test("em HTTPS os dois cookies atravessam o iframe do painel", () => {
  // `Partitioned` é o ponto: sem ele o cookie não existe no iframe (`Lax`) ou
  // existe demais (`None` sozinho, viajando em toda requisição entre sites).
  for (const [nome, cookie] of [
    ["sessão", sessionCookie("valor", HTTPS)],
    ["aperto de mão", handshakeCookie("volund_auth_handshake", "valor", HTTPS)],
  ] as const) {
    const a = attrs(cookie);
    assert.ok(
      a.includes("samesite=none"),
      `${nome}: sem SameSite=None não chega ao iframe`,
    );
    assert.ok(
      a.includes("partitioned"),
      `${nome}: sem Partitioned vira cookie de terceiro`,
    );
    assert.ok(a.includes("secure"), `${nome}: Partitioned exige Secure`);
    assert.ok(!a.includes("samesite=lax"), `${nome}: Lax é o defeito que isto corrige`);
  }
});

test("`Partitioned` nunca sai sem `Secure`", () => {
  // O navegador descarta o cookie inteiro nessa combinação — e descartar o
  // cookie de sessão é o login parar de funcionar, não um detalhe de atributo.
  for (const cookie of [
    sessionCookie("valor", HTTPS),
    sessionCookie("valor", LOCAL),
    handshakeCookie("h", "valor", HTTPS),
    handshakeCookie("h", "valor", LOCAL),
    clearedCookie("h", HTTPS),
    clearedCookie("h", LOCAL),
  ]) {
    const a = attrs(cookie);
    if (a.includes("partitioned")) {
      assert.ok(a.includes("secure"), `Partitioned sem Secure: ${cookie}`);
    }
  }
});

test("no endereço local continua `Lax`, e sem `Secure`", () => {
  // `SameSite=None` sem `Secure` é recusado pelo navegador, e em `http://
  // localhost` não há `Secure` a dar. Mandar `None` ali quebraria o login na
  // máquina de quem desenvolve — e endereço local não é enquadrado por ninguém.
  for (const cookie of [
    sessionCookie("valor", LOCAL),
    handshakeCookie("volund_auth_handshake", "valor", LOCAL),
  ]) {
    const a = attrs(cookie);
    assert.ok(a.includes("samesite=lax"), `local devia ser Lax: ${cookie}`);
    assert.ok(!a.includes("secure"), `local não tem Secure a oferecer: ${cookie}`);
    assert.ok(
      !a.includes("partitioned"),
      `Partitioned sem Secure seria descartado: ${cookie}`,
    );
  }
});

test("limpar o cookie usa os MESMOS atributos que o criaram", () => {
  // Um cookie particionado só é apagado por um `Set-Cookie` com os mesmos
  // atributos. Se a limpeza saísse como `Lax`, o navegador criaria/limparia
  // outro pote e a sessão continuaria de pé depois de "Sair" — dentro do painel,
  // que é justamente onde o particionado existe.
  const criado = attrs(sessionCookie("valor", HTTPS)).filter(
    (a) => !a.startsWith("max-age"),
  );
  const limpo = attrs(clearedCookie("volund_auth_session", HTTPS)).filter(
    (a) => !a.startsWith("max-age"),
  );

  assert.deepEqual(limpo, criado);
});

test("os dois cookies continuam fora do alcance do JavaScript", () => {
  // `HttpOnly` não é negociável, e mexer em SameSite é exatamente o tipo de
  // mudança em que ele se perde por descuido.
  for (const cookie of [
    sessionCookie("valor", HTTPS),
    handshakeCookie("h", "valor", HTTPS),
    sessionCookie("valor", LOCAL),
  ]) {
    assert.ok(attrs(cookie).includes("httponly"), `sem HttpOnly: ${cookie}`);
  }
});
