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
    "cb16c4dfe718a80a673970542263688f7a2e8cd0554b6275b1ecf8d0c53057f5",
  "app-appearance.json":
    "b43a394fbfb8bde1493a57faf7e012d7fe2134f4c250bae159350f81c00557f2",
  "auth-claims.json":
    "3961da30c8bc3a42dfaced52b65a5c02e81e87cc46aa43d17e5b8b1a6520a520",
  "frame-protocol.json":
    "cad3a205117e70bfa4586f642b2cefc8a771b19eae3b9e48a610bd467b4c96d0",
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
