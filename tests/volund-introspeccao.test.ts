// A introspecção da superfície (contrato 4): a rota que a PLATAFORMA usa para
// conferir se o que este App declarou é o que ele expõe.
//
// O que se guarda aqui:
//
//   1. **A assinatura é o portão.** Sem ela, com ela errada, ou fora da janela,
//      a rota recusa — e recusa igual, sem dizer qual dos casos foi;
//   2. **A janela vale nos dois sentidos**, senão quem escolhe o próprio relógio
//      tem janela infinita;
//   3. **A rota está na allow-list do portão de cookie**, senão ela responderia
//      401 antes de a assinatura ser sequer lida;
//   4. **A lista de tools sai INTEIRA**, sem o filtro de `can()` — é o ponto
//      inteiro de a rota existir.
//
// Rodar: npm test -- tests/volund-introspeccao.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { isPublicRoute } from "../lib/auth/route-policy";
import {
  INTROSPECTION_PATH,
  SIGNATURE_WINDOW_SECONDS,
  sign,
  signaturePayload,
  verifySignature,
} from "../lib/volund/introspection";

const SECRET = "segredo-compartilhado-com-a-plataforma";
const NOW = 1_760_000_000;

function assinado(now = NOW, path = INTROSPECTION_PATH) {
  return {
    secret: SECRET,
    path,
    timestampHeader: String(now),
    signatureHeader: sign(SECRET, path, now),
    now: NOW,
  };
}

test("assinatura válida passa", () => {
  assert.deepEqual(verifySignature(assinado()), { ok: true });
});

test("sem os cabeçalhos, recusa", () => {
  assert.equal(verifySignature({ ...assinado(), timestampHeader: null }).ok, false);
  assert.equal(verifySignature({ ...assinado(), signatureHeader: null }).ok, false);
});

test("instante ilegível recusa ANTES da comparação de janela", () => {
  // `Number("")` é 0 e `Number("abc")` é NaN. O segundo é o perigoso: `NaN` em
  // qualquer comparação é `false`, então uma guarda escrita como
  // `if (diferenca > janela) recusa` deixaria passar.
  for (const bad of ["", "abc", "12.5", "Infinity", "1e400"]) {
    const out = verifySignature({ ...assinado(), timestampHeader: bad });
    assert.equal(out.ok, false, `${bad} deveria ser recusado`);
  }
});

test("a janela vale nos DOIS sentidos", () => {
  const alem = SIGNATURE_WINDOW_SECONDS + 1;
  // Velha demais.
  assert.equal(verifySignature(assinado(NOW - alem)).ok, false);
  // E no FUTURO: aceitar o futuro daria janela infinita a quem escolhe o
  // próprio relógio.
  assert.equal(verifySignature(assinado(NOW + alem)).ok, false);
  // Na borda, ainda passa.
  assert.equal(verifySignature(assinado(NOW - SIGNATURE_WINDOW_SECONDS)).ok, true);
});

test("assinatura de OUTRO caminho não vale aqui", () => {
  // Sem o caminho na mensagem, uma assinatura emitida para a introspecção
  // valeria para qualquer rota que um dia adotasse o mesmo esquema.
  const outra = sign(SECRET, "/api/outra-coisa", NOW);
  assert.equal(verifySignature({ ...assinado(), signatureHeader: outra }).ok, false);
});

test("assinatura de outro segredo não vale", () => {
  const impostor = sign("outro-segredo", INTROSPECTION_PATH, NOW);
  assert.equal(verifySignature({ ...assinado(), signatureHeader: impostor }).ok, false);
});

test("a mensagem assinada é caminho + instante, nesta ordem", () => {
  // As duas pontas precisam concordar byte a byte. Um teste sobre o FORMATO
  // impede que uma mudança inocente aqui quebre a plataforma em silêncio.
  assert.equal(signaturePayload("/x", 123), "/x\n123");
});

test("a rota está na allow-list do portão de cookie", () => {
  // Sem isto, o portão responde 401 antes de a assinatura ser lida — e a
  // plataforma não conseguiria distinguir "recusei" de "não tenho a rota".
  assert.equal(isPublicRoute(INTROSPECTION_PATH), true);
});

test("a rota devolve a lista INTEIRA, sem filtro de `can()`", async () => {
  // O ponto de a rota existir. Se ela filtrasse, a comparação com o snapshot
  // declarado acusaria deriva falsa — e esconderia a deriva real, que é
  // justamente a tool exigindo chave fora do catálogo.
  const { TOOLS } = await import("../lib/mcp/tools");
  const fonte = await import("node:fs").then((fs) =>
    fs.readFileSync("app/api/_volund/surface/route.ts", "utf8"),
  );

  // O IMPORT, e não a palavra: o cabeçalho da rota explica por que ela NÃO usa
  // `can()`, e procurar o termo solto reprovava a própria explicação. É a quinta
  // vez nesta esteira que uma asserção casa com o comentário em vez do código.
  assert.ok(
    !/from "@\/lib\/auth\/permissions"/.test(fonte),
    "a introspecção não importa `can()` — seria o mesmo filtro do `tools/list`",
  );
  assert.ok(!/^\s*(?!\s*\*|\s*\/\/).*\bcan\(/m.test(fonte), "e não o chama em código");
  assert.ok(fonte.includes("Object.values(TOOLS)"), "ela percorre o registro inteiro");
  // E o registro tem tools de permissão diferente, então "inteiro" não é
  // trivialmente igual a "as que qualquer um pode chamar".
  const permissoes = new Set(Object.values(TOOLS).map((t) => t.permission));
  assert.ok(permissoes.size > 1, "o registro tem tools abertas E restritas");
});

test("`endpoints` sai como `null`, e não como lista vazia", async () => {
  // `[]` seria lido pela plataforma como "este App não expõe endpoint nenhum" e
  // marcaria como deriva todo endpoint declarado. Deriva falsa é o modo de
  // falhar que a verificação existe para evitar. `null` diz "não introspecto
  // isto", e a plataforma pula essa metade.
  const fonte = await import("node:fs").then((fs) =>
    fs.readFileSync("app/api/_volund/surface/route.ts", "utf8"),
  );
  assert.match(fonte, /endpoints: null/);
});
