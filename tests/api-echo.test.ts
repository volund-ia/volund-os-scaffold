// Exemplo de teste — o padrão que os testes da aplicação devem seguir.
//
// Roda com o runner do próprio Node (`node:test`), transpilado por `tsx`: zero
// dependência de framework de teste, mesma escolha do VolundOS. Um teste que
// exista de verdade vale mais que um placeholder, então este exercita a
// validação de entrada de uma rota REAL deste scaffold.
//
// Rodar: npm test
import assert from "node:assert/strict";
import { test } from "node:test";

import { POST } from "../app/api/echo/route";

/** Monta uma Request com corpo JSON, como o Next entrega à rota. */
function jsonRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/echo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("aceita corpo válido e devolve o eco", async () => {
  const res = await POST(jsonRequest({ mensagem: "olá", repetir: 3 }));
  assert.equal(res.status, 200);
  const data = (await res.json()) as { eco: string[] };
  assert.deepEqual(data.eco, ["olá", "olá", "olá"]);
});

test("repetir é opcional e cai em 1", async () => {
  const res = await POST(jsonRequest({ mensagem: "só uma vez" }));
  const data = (await res.json()) as { eco: string[] };
  assert.deepEqual(data.eco, ["só uma vez"]);
});

test("recusa corpo inválido com 400 e diz qual campo falhou", async () => {
  // O ponto do teste: a rota não confia no cliente. Sem validação, `mensagem`
  // vazia seguiria adiante e o erro apareceria longe daqui.
  const res = await POST(jsonRequest({ mensagem: "" }));
  assert.equal(res.status, 400);
  const data = (await res.json()) as { error: string; issues: string[] };
  assert.match(data.error, /inválidos/i);
  assert.ok(
    data.issues.some((i) => i.startsWith("mensagem:")),
    `esperava um problema apontando o campo; veio ${JSON.stringify(data.issues)}`,
  );
});

test("recusa tipo errado sem estourar exceção", async () => {
  const res = await POST(jsonRequest({ mensagem: "ok", repetir: "três" }));
  assert.equal(res.status, 400);
});

test("recusa JSON malformado com mensagem própria", async () => {
  // `request.json()` lança nesse caso — a rota tem que responder 400, não 500.
  const res = await POST(
    new Request("http://localhost:3000/api/echo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{isto não é json",
    }),
  );
  assert.equal(res.status, 400);
  const data = (await res.json()) as { error: string };
  assert.match(data.error, /JSON/i);
});
