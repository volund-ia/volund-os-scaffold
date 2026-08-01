// A allow-list do portão. É a regra que decide o que este App expõe à internet,
// então ela é exercitada diretamente, sem subir o Next: o `proxy.ts` consulta
// exatamente estas funções.
import assert from "node:assert/strict";
import { test } from "node:test";

import { PUBLIC_ROUTES, expectsHtml, isPublicRoute } from "../lib/auth/route-policy";

test("o callback do OIDC é público — senão o login nunca termina", () => {
  // Ele é chamado ANTES de existir sessão: é ele quem a estabelece.
  assert.equal(isPublicRoute("/api/auth/callback"), true);
});

test("o início do login é público", () => {
  assert.equal(isPublicRoute("/api/auth/login"), true);
});

test("a vitrine é pública, para o endereço publicado abrir", () => {
  assert.equal(isPublicRoute("/"), true);
});

test("logout NÃO é público, embora more sob /api/auth", () => {
  // O caso que a liberação por prefixo estragaria: `/api/auth/*` inteiro
  // liberado deixaria esta rota aberta sem ninguém ter decidido isso.
  assert.equal(isPublicRoute("/api/auth/logout"), false);
});

test("rota nova criada pelo agente exige sessão por herança", () => {
  for (const rota of ["/painel", "/api/pedidos", "/relatorios/2026", "/api/auth"]) {
    assert.equal(isPublicRoute(rota), false, `${rota} deveria exigir sessão`);
  }
});

test("liberação é por igualdade, não por prefixo", () => {
  // `/api/auth/callback-de-mentira` tem o caminho público como prefixo. Se a
  // comparação fosse `startsWith`, ele passaria.
  assert.equal(isPublicRoute("/api/auth/callback-de-mentira"), false);
  assert.equal(isPublicRoute("/api/auth/callback/extra"), false);
});

test("arquivo em public/ exige sessão até ser enumerado", () => {
  // Comportamento deliberado, não esquecimento: `public/` é onde se larga
  // arquivo sem pensar, e dispensar a pasta inteira publicaria o PDF que alguém
  // deixou lá. Um asset que a vitrine precisa entra na lista, um por linha.
  assert.equal(isPublicRoute("/imagens/capa.png"), false);
  assert.equal(isPublicRoute("/relatorio-interno.pdf"), false);
});

test("barra final não cria um caminho diferente", () => {
  assert.equal(isPublicRoute("/api/auth/callback/"), true);
  assert.equal(isPublicRoute("/"), true);
});

test("a lista pública é curta e enumerada", () => {
  // Guarda de tamanho: crescer aqui é uma decisão de segurança e deve custar um
  // teste vermelho, não passar despercebido numa revisão.
  assert.deepEqual([...PUBLIC_ROUTES].sort(), [
    "/",
    "/api/auth/callback",
    "/api/auth/login",
  ]);
});

test("navegação leva redirecionamento; chamada de API leva 401", () => {
  assert.equal(
    expectsHtml(new Headers({ accept: "text/html,application/xhtml+xml" })),
    true,
  );
  assert.equal(expectsHtml(new Headers({ accept: "application/json" })), false);
  assert.equal(expectsHtml(new Headers()), false);
});
