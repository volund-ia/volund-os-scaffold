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
    // Contrato 5: o metadado de recurso protegido (RFC 9728). É o único desta
    // lista que é público DE VERDADE, e não "público para o portão de cookie":
    // ele é lido antes de existir qualquer token, a spec de autorização do MCP
    // manda o cliente buscá-lo sem credencial, e não há nada a proteger nele —
    // são o endereço do endpoint MCP e o do provedor, ambos já conhecidos por
    // quem tem o link do App.
    "/.well-known/oauth-protected-resource",
    // Contrato 4: a introspecção da superfície. Dispensa o portão de COOKIE
    // porque quem chama é a plataforma, servidor a servidor; o portão dela é a
    // assinatura HMAC conferida na própria rota. Ver o teste logo abaixo.
    "/api/_volund/surface",
    "/api/auth/callback",
    "/api/auth/login",
    "/api/mcp",
  ]);
});

test("o endpoint MCP dispensa o cookie, e só o cookie", () => {
  // Quem chama o MCP é um agente: ele apresenta `Authorization: Bearer <token>` e
  // não tem cookie nenhum. Exigir sessão de cookie aqui recusaria toda chamada de
  // agente ANTES de o token ser lido — e a autenticação, que existe, nunca
  // aconteceria.
  //
  // Isto NÃO é uma rota aberta. O portão foi trocado, não removido: sem token
  // válido `app/api/mcp/route.ts` responde 401, e cada tool passa pelo `can()` do
  // serviço. É a única entrada da lista cujo portão vive na própria rota — e é por
  // isso que ela merece um teste com o motivo escrito, em vez de só uma linha na
  // lista acima.
  assert.equal(isPublicRoute("/api/mcp"), true);
  // E vale para o caminho exato: uma sub-rota nova debaixo dele não herda a
  // dispensa, porque a comparação é por igualdade.
  assert.equal(isPublicRoute("/api/mcp/qualquer-coisa"), false);
});

test("navegação leva redirecionamento; chamada de API leva 401", () => {
  assert.equal(
    expectsHtml(new Headers({ accept: "text/html,application/xhtml+xml" })),
    true,
  );
  assert.equal(expectsHtml(new Headers({ accept: "application/json" })), false);
  assert.equal(expectsHtml(new Headers()), false);
});
