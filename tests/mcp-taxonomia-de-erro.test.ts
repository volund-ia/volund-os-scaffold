// A taxonomia de falha atravessa as três portas com o MESMO significado.
//
// A rota HTTP traduz os seis códigos em status (`lib/http/service-route.ts`, com a
// tabela amarrada por `satisfies`); aqui é a outra ponta, a do agente. Se as duas
// traduções divergirem, a mesma recusa chega diferente para a pessoa e para o
// agente — e é justamente essa divergência que esta arquitetura existe para não
// ter.
//
// O que este arquivo vigia: todo código produz `isError`, o código VIAJA no texto
// (o agente decide sem interpretar prosa), a permissão que falta é nomeada, os
// campos inválidos são listados, e `internal` não conta o que aconteceu.
//
// Rodar: npm test
import assert from "node:assert/strict";
import { test } from "node:test";

import { toolResultFromService } from "../lib/mcp/result";
import { fail, ok, type ServiceErrorCode } from "../lib/services/types";

const TODOS: ServiceErrorCode[] = [
  "unauthenticated",
  "forbidden",
  "invalid_input",
  "not_found",
  "conflict",
  "internal",
];

test("sucesso vira conteúdo legível, sem marca de erro", () => {
  const res = toolResultFromService(ok({ eco: ["oi"] }));
  assert.equal(res.isError, undefined);
  assert.equal(res.content.length, 1);
  assert.equal(res.content[0]?.type, "text");
  // JSON: o agente lê e usa. Texto solto obrigaria a interpretar.
  assert.deepEqual(JSON.parse(res.content[0]?.text ?? ""), { eco: ["oi"] });
});

test("todo modo de falhar chega marcado, e com o código no texto", () => {
  // Sem o código, o agente não distingue "peça acesso" de "corrija o campo" de
  // "não insista" — e repetiria a chamada que nunca vai passar.
  for (const codigo of TODOS) {
    const res = toolResultFromService(fail(codigo, "Não deu."));
    assert.equal(res.isError, true, `${codigo} tinha de vir marcado como erro`);
    assert.match(
      res.content[0]?.text ?? "",
      new RegExp(`código: ${codigo}`),
      `${codigo} tinha de aparecer no texto`,
    );
  }
});

test("falta de permissão nomeia a permissão que falta", () => {
  // É o que torna a recusa acionável: o agente tem o nome exato para pedir a quem
  // administra o App, em vez de só saber que não pode.
  const res = toolResultFromService(
    fail("forbidden", "Você não tem permissão para esta ação.", {
      permission: "fechar_mes",
    }),
  );
  assert.equal(res.isError, true);
  assert.match(res.content[0]?.text ?? "", /fechar_mes/);
});

test("entrada inválida lista os campos com problema", () => {
  const res = toolResultFromService(
    fail("invalid_input", "Dados inválidos.", {
      issues: ["mensagem: não pode ser vazia", "repetir: máximo de 5"],
    }),
  );
  assert.match(res.content[0]?.text ?? "", /mensagem: não pode ser vazia/);
  assert.match(res.content[0]?.text ?? "", /repetir: máximo de 5/);
});

test("internal não conta o que aconteceu", () => {
  // A mensagem de `internal` já nasce genérica no serviço; esta camada não pode
  // acrescentar detalhe nenhum. O que o agente recebe não pode conter host, porta
  // nem configuração de conexão.
  const res = toolResultFromService(
    fail("internal", "Não foi possível concluir a operação."),
  );
  const texto = res.content[0]?.text ?? "";
  assert.equal(res.isError, true);
  assert.match(texto, /código: internal/);
  assert.doesNotMatch(texto, /ECONNREFUSED|5432|password|senha/i);
});
