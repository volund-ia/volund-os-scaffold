// Os quatro contratos são IDÊNTICOS, byte a byte, neste repositório e no
// volund-os.
//
// ## Por que um hash fixo, e não uma comparação com o outro repositório
//
// Este teste roda sem rede e sem o outro repositório ao lado — no CI do
// scaffold, num fork, no container do agente. O que ele pode conferir sozinho é
// que o arquivo daqui é o que as duas pontas combinaram: o hash gravado abaixo é
// o do arquivo canônico, o MESMO que está em `contracts/` do volund-os.
//
// Editar um contrato sem atualizar o hash reprova aqui — e é de propósito: a
// mudança tem de ir para os dois repositórios juntos (copie o arquivo para o
// outro lado, confira com `cmp`, e só então troque o hash). O que este teste NÃO
// faz é ver a cópia do outro lado: lá, a guarda é a revisão e o `cmp` do mesmo
// procedimento.
//
// Rodar: npm test
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

/** sha256 do arquivo canônico. Mude SÓ junto com a cópia do volund-os. */
const CANONICOS: Record<string, string> = {
  "agent-channel.json":
    "c9561a95101ba32cf085fd6f349597ecfaae8262f3af2f84511975a6243edb3d",
  "app-appearance.json":
    "2a89c3352d0f79133aae5d8955ed4a906b1dd3bf1b720fdc30a97db5e5d6047e",
  "auth-claims.json":
    "5dad83fc0d5c17771ad2a2287115e7e4c7e5c69e5ca8bae5103f4e2d6ebec43c",
  "frame-protocol.json":
    "b90f3a79b6024b7cd64757a669905d35b316faf3471276f8e0b5a8b9247c7905",
};

const dir = new URL("../contracts/", import.meta.url);

test("cada contrato é o arquivo canônico combinado com o volund-os", () => {
  for (const [arquivo, esperado] of Object.entries(CANONICOS)) {
    const hash = createHash("sha256")
      .update(readFileSync(new URL(arquivo, dir)))
      .digest("hex");
    assert.equal(
      hash,
      esperado,
      `contracts/${arquivo} divergiu do canônico: leve a mudança ao volund-os, confira com cmp e só então atualize o hash`,
    );
  }
});

test("nenhum contrato novo fica fora da lista", () => {
  // Um quinto contrato que nascesse aqui sem entrar na lista escaparia da
  // guarda inteira — e é exatamente o arquivo novo o que mais diverge.
  const presentes = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  assert.deepEqual(presentes, Object.keys(CANONICOS).sort());
});

test("os quatro andam com o número de contrato do manifesto", () => {
  const manifesto = JSON.parse(
    readFileSync(new URL("../volund-scaffold.json", import.meta.url), "utf8"),
  ) as { contract: number };
  for (const arquivo of Object.keys(CANONICOS)) {
    const { contract } = JSON.parse(readFileSync(new URL(arquivo, dir), "utf8")) as {
      contract: number;
    };
    assert.equal(contract, manifesto.contract, `contracts/${arquivo}`);
  }
});
