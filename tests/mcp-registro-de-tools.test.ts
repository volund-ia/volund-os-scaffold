// O risco central desta arquitetura não é uma tool que falha: é uma tool que
// funciona **por conta própria**. Uma tool com regra própria vira uma segunda
// implementação da mesma decisão, e as duas divergem na terceira mudança — sem
// dar erro, respondendo diferente para a mesma pergunta.
//
// Estes testes reprovam exatamente isso, por três caminhos, porque nenhum
// sozinho cobre o buraco:
//
//   1. estrutura — toda tool registrada saiu de `defineTool` e aponta para um
//      serviço REGISTRADO (a marca de fábrica é o que impede um objeto com a
//      forma de tool, e um corpo próprio dentro, de entrar no registro);
//   2. comportamento — chamar a tool passa pelo portão do serviço: sem sessão
//      recusa, sem a permissão recusa, com a permissão atende. Uma tool que
//      tivesse copiado a regra responderia outra coisa em algum desses casos;
//   3. texto — o arquivo do registro não consulta banco nem confere permissão.
//
// Rodar: npm test
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { z } from "zod";

import type { Session } from "../lib/auth/session";
import { defineTool, getTool, TOOL_MARK, TOOLS } from "../lib/mcp/tools";
import { defineService } from "../lib/services/define";
import { getService } from "../lib/services/index";
import { ok } from "../lib/services/types";

function sessao(permissoes: string[] = []): Session {
  return {
    userId: "11111111-1111-1111-1111-111111111111",
    orgId: "22222222-2222-2222-2222-222222222222",
    appId: "33333333-3333-3333-3333-333333333333",
    email: "pessoa@exemplo.test",
    name: "Pessoa de Teste",
    roles: [],
    permissions: permissoes,
    accessToken: "token-de-teste",
  };
}

test("o registro não está vazio e as chaves são os nomes das tools", () => {
  const tools = Object.entries(TOOLS);
  assert.ok(tools.length > 0, "o scaffold precisa nascer com tools de exemplo");
  for (const [chave, tool] of tools) {
    assert.equal(chave, tool.name, `registro: a chave ${chave} não é o nome da tool`);
  }
});

test("toda tool registrada saiu de defineTool", () => {
  // Sem a marca, alguém escreve um objeto com a forma de `Tool` — e um `call`
  // com a regra dentro — e o registro aceita.
  for (const tool of Object.values(TOOLS)) {
    assert.equal(
      tool[TOOL_MARK],
      true,
      `${tool.name} não foi criada por defineTool; regra própria entraria por aqui`,
    );
  }
});

test("toda tool aponta para um serviço registrado", () => {
  for (const tool of Object.values(TOOLS)) {
    assert.equal(
      getService(tool.service.name),
      tool.service,
      `${tool.name}: o serviço não é o mesmo objeto registrado em lib/services/index.ts`,
    );
  }
});

test("kind e permissão da tool são os do serviço, não uma segunda declaração", () => {
  // É a deriva que a governança teria de descobrir depois: uma tool anunciada
  // como `read` alcançando um serviço que grava. Derivando, ela não existe.
  for (const tool of Object.values(TOOLS)) {
    assert.equal(tool.kind, tool.service.kind, `${tool.name}: kind divergente`);
    assert.equal(
      tool.permission,
      tool.service.permission,
      `${tool.name}: permissão divergente`,
    );
    assert.ok(tool.kind === "read" || tool.kind === "write");
  }
});

test("nenhuma tool roda sem sessão", async () => {
  for (const tool of Object.values(TOOLS)) {
    const res = await tool.call(null, {});
    assert.equal(res.ok, false, `${tool.name} atendeu sem sessão`);
    if (!res.ok) assert.equal(res.error.code, "unauthenticated");
  }
});

test("toda tool protegida recusa quem não tem a permissão — e atende quem tem", async () => {
  // A prova de que a chamada atravessa o portão do serviço, e não um caminho
  // próprio: o veredito e a permissão citada saem do serviço.
  const protegidas = Object.values(TOOLS).filter((tool) => tool.permission !== null);
  assert.ok(
    protegidas.length > 0,
    "o scaffold precisa de pelo menos uma tool protegida como exemplo",
  );

  for (const tool of protegidas) {
    const permissao = tool.permission as string;

    const negado = await tool.call(sessao(), {});
    assert.equal(negado.ok, false, `${tool.name} atendeu sem a permissão`);
    if (!negado.ok) {
      assert.equal(negado.error.code, "forbidden");
      assert.equal(negado.error.permission, permissao);
    }

    // A entrada vazia não serve para toda tool, e este teste não é sobre
    // entrada: o que ele vigia é o eixo da permissão. Quem tem a permissão pode
    // até tomar `invalid_input` — o que não pode é tomar `forbidden`.
    const permitido = await tool.call(sessao([permissao]), {});
    if (!permitido.ok) {
      assert.notEqual(
        permitido.error.code,
        "forbidden",
        `${tool.name} recusou por permissão quem tem a permissão`,
      );
    }
  }
});

test("tool sem permissão não é barrada por permissão", async () => {
  const semPermissao = Object.values(TOOLS).filter((tool) => tool.permission === null);
  assert.ok(semPermissao.length > 0, "o exemplo precisa cobrir os dois casos");
  for (const tool of semPermissao) {
    const res = await tool.call(sessao(), {});
    if (!res.ok) {
      // Mesma razão do caso acima: `ecoar` exige uma mensagem, e cobrar entrada
      // válida de toda tool aqui faria este teste falhar por motivo alheio.
      for (const codigo of ["forbidden", "unauthenticated"] as const) {
        assert.notEqual(
          res.error.code,
          codigo,
          `${tool.name} respondeu ${codigo} a quem tem sessão e não exige permissão`,
        );
      }
    }
  }
});

test("com a permissão concedida, a tool de exemplo atende de fato", async () => {
  // O caso positivo concreto, com entrada válida. Os dois testes acima varrem
  // todas as tools e por isso não podem exigir sucesso; este exige.
  const diagnostico = getTool("ver_diagnostico");
  assert.ok(diagnostico);
  const res = await diagnostico.call(sessao(["ver_diagnostico"]), {});
  assert.equal(res.ok, true);

  const eco = getTool("ecoar");
  assert.ok(eco);
  const resEco = await eco.call(sessao(), { mensagem: "oi", repetir: 2 });
  assert.equal(resEco.ok, true);
  if (resEco.ok) {
    assert.deepEqual((resEco.data as { eco: string[] }).eco, ["oi", "oi"]);
  }
});

test("entrada inválida na tool é recusada pelo serviço, sem lançar", async () => {
  const servico = defineService({
    name: "marcar_sala",
    summary: "Marca uma sala.",
    kind: "write",
    permission: "marcar_sala",
    input: z.object({ sala: z.string().min(1) }),
    run: (_session, input) => ok(input),
  });
  // O serviço acima não está registrado, então a tool tem de ser recusada — e é
  // isso que o próximo caso testa. Aqui o que interessa é o serviço em si.
  const res = await servico.execute(sessao(["marcar_sala"]), { sala: "" });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error.code, "invalid_input");
});

test("tool sobre serviço não registrado é recusada", () => {
  const solto = defineService({
    name: "marcar_sala",
    summary: "Marca uma sala.",
    kind: "write",
    permission: "marcar_sala",
    input: z.object({}),
    run: () => ok(null),
  });
  assert.throws(
    () =>
      defineTool({
        name: "marcar_sala",
        description: "Marca uma sala para a pessoa que está pedindo.",
        service: solto,
      }),
    /não é o que está registrado/,
  );
});

test("tool sobre um sósia do serviço registrado é recusada", () => {
  // Mesmo nome, outro objeto. Aceitar faria a superfície declarada descrever um
  // App que não é este: o inventário sai do registro de serviços.
  const sosia = defineService({
    name: "ver_diagnostico",
    summary: "Cópia com o mesmo nome do serviço registrado.",
    kind: "read",
    permission: "ver_diagnostico",
    input: z.object({}),
    run: () => ok({ falso: true }),
  });
  assert.throws(
    () =>
      defineTool({
        name: "ver_diagnostico_2",
        description: "Deveria ser recusada por não usar o serviço registrado.",
        service: sosia,
      }),
    /não é o que está registrado/,
  );
});

test("tool sem descrição de verdade é recusada", () => {
  // A descrição é o que faz o agente escolher esta tool em vez de tentar outra
  // coisa. Um rótulo de duas palavras não é descrição.
  const servico = getService("ver_perfil");
  assert.ok(servico);
  assert.throws(
    () => defineTool({ name: "ver_perfil_2", description: "perfil", service: servico }),
    /descrição/,
  );
});

test("nome de tool fora do formato é recusado", () => {
  const servico = getService("ver_perfil");
  assert.ok(servico);
  for (const nome of ["Ver Perfil", "ver:perfil", "", "1_ver"]) {
    assert.throws(
      () =>
        defineTool({
          name: nome,
          description: "Descrição suficientemente longa para passar.",
          service: servico,
        }),
      /nome/,
      `deveria recusar o nome ${JSON.stringify(nome)}`,
    );
  }
});

test("mapInput sem schema próprio é recusado", () => {
  // Traduzir a entrada é trabalho de adaptador; traduzir sem declarar o que se
  // aceita é regra escondida na tool.
  const servico = getService("ver_perfil");
  assert.ok(servico);
  assert.throws(
    () =>
      defineTool({
        name: "ver_perfil_3",
        description: "Descrição suficientemente longa para passar.",
        service: servico,
        mapInput: (entrada) => entrada,
      }),
    /mapInput/,
  );
});

test("getTool só devolve tool registrada, nunca herdada", () => {
  // O nome vem do agente. Sem a checagem de propriedade própria,
  // `getTool("toString")` devolveria a função herdada do protótipo.
  for (const herdado of ["toString", "constructor", "hasOwnProperty", "__proto__"]) {
    assert.equal(getTool(herdado), undefined, `getTool(${herdado}) devolveu algo`);
  }
  assert.ok(getTool("ver_perfil"), "a tool registrada continua sendo achada");
});

test("o registro de tools não reimplementa regra", () => {
  // O anti-padrão em forma de teste: banco e permissão não se tocam aqui. Quem
  // consulta o banco e quem confere `can()` é o serviço — a tool só chama.
  const pasta = path.join(import.meta.dirname, "..", "lib", "mcp");
  const proibidos: [RegExp, string][] = [
    [/from\s+['"]\.\.\/db['"]/, "consultar o banco aqui é reimplementar o serviço"],
    [/\bquery\(/, "consultar o banco aqui é reimplementar o serviço"],
    [/\bcan\(/, "conferir permissão aqui duplica a decisão do serviço"],
    [/from\s+['"]next\//, "a tool não conhece o pedido HTTP"],
  ];

  const arquivos = readdirSync(pasta).filter((nome) => nome.endsWith(".ts"));
  assert.ok(arquivos.length > 0, "não achei os arquivos de lib/mcp");

  for (const arquivo of arquivos) {
    const conteudo = readFileSync(path.join(pasta, arquivo), "utf8");
    for (const [padrao, motivo] of proibidos) {
      assert.doesNotMatch(conteudo, padrao, `lib/mcp/${arquivo}: ${motivo}`);
    }
  }
});
