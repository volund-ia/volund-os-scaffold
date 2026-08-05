// A camada de serviço é onde a regra de negócio deste App mora, e a razão de ela
// existir é que a mesma decisão vai ser alcançada por mais de uma porta — a tela,
// a rota de API e, adiante, a tool de MCP. Se cada porta puder decidir por conta
// própria, elas divergem; e a divergência não aparece como erro, aparece como
// resposta diferente para a mesma pergunta.
//
// Estes testes vigiam as garantias que sustentam isso:
//
//   1. nenhum serviço roda sem sessão;
//   2. serviço com permissão declarada recusa quem não a tem — de leitura tanto
//      quanto de escrita, porque leitura protegida é o caso mais comum;
//   3. serviço sem permissão está DECLARADO como tal, numa lista explícita;
//   4. a camada não conhece HTTP.
//
// A garantia 2 é a que mais precisa de teste: o sintoma de esquecer a checagem é
// ausência de erro — o serviço funciona, para todo mundo.
//
// Rodar: npm test
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { z } from "zod";

import type { Session } from "../lib/auth/session";
import { defineService } from "../lib/services/define";
import { getService, SERVICES } from "../lib/services/index";
import { PUBLIC_SERVICES } from "../lib/services/policy";
import { fail, ok } from "../lib/services/types";

/** Uma sessão como a que `lib/auth/session.ts` entrega, com as permissões pedidas. */
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

/** Serviço protegido de mentira, para exercitar o portão sem depender do exemplo. */
const servicoProtegido = defineService({
  name: "fechar_mes",
  summary: "Fecha o mês.",
  kind: "write",
  permission: "fechar_mes",
  input: z.object({ competencia: z.string().min(1) }),
  run: (session, input) => ok({ fechadoPor: session.userId, ...input }),
});

test("nenhum serviço roda sem sessão — nem o que não exige permissão", async () => {
  // "Público" nesta camada quer dizer "não exige permissão", e não "não exige
  // sessão". Se `execute(null, …)` atendesse, a lista de PUBLIC_SERVICES teria
  // virado, sem ninguém decidir isso, uma lista de serviços anônimos.
  for (const servico of [servicoProtegido, getService("ver_perfil")]) {
    assert.ok(servico, "o serviço de exemplo precisa estar registrado");
    const res = await servico.execute(null, {});
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.error.code, "unauthenticated");
  }
});

test("serviço protegido recusa quem não tem a permissão, e diz qual falta", async () => {
  const res = await servicoProtegido.execute(sessao(), { competencia: "2026-08" });
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.error.code, "forbidden");
    // A tela usa isto para explicar o que pedir a quem administra. Sem o campo, a
    // única saída seria repetir a permissão na interface — e aí os dois textos
    // divergem na primeira renomeação.
    assert.equal(res.error.permission, "fechar_mes");
  }
});

test("serviço protegido atende quem tem a permissão", async () => {
  const res = await servicoProtegido.execute(sessao(["fechar_mes"]), {
    competencia: "2026-08",
  });
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.data.competencia, "2026-08");
});

test("leitura protegida é conferida como a escrita", async () => {
  // O exemplo `ver_diagnostico` existe justamente para isto: é leitura, e é
  // protegida. Cobrir só escrita deixaria de fora o caso mais comum num App real.
  const servico = getService("ver_diagnostico");
  assert.ok(servico);
  assert.equal(servico.kind, "read");

  const negado = await servico.execute(sessao(), {});
  assert.equal(negado.ok, false);

  const permitido = await servico.execute(sessao(["ver_diagnostico"]), {});
  assert.equal(permitido.ok, true);
});

test("a permissão é conferida ANTES da entrada", async () => {
  // Validar primeiro devolveria a quem não pode chamar o serviço a lista dos
  // campos que ele aceita — informação sobre o desenho interno do App para quem
  // não tem acesso a ele.
  const res = await servicoProtegido.execute(sessao(), { competencia: "" });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error.code, "forbidden");
});

test("entrada inválida vira invalid_input apontando o campo, sem lançar", async () => {
  const res = await servicoProtegido.execute(sessao(["fechar_mes"]), {});
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.error.code, "invalid_input");
    assert.ok(
      res.error.issues?.some((problema) => problema.startsWith("competencia:")),
      `esperava um problema apontando o campo; veio ${JSON.stringify(res.error.issues)}`,
    );
  }
});

test("exceção dentro do serviço vira internal e não conta o que aconteceu", async (t) => {
  const registrado = t.mock.method(console, "error", () => {});

  const servico = defineService({
    name: "consultar_saldo",
    summary: "Consulta o saldo.",
    kind: "read",
    permission: "consultar_saldo",
    input: z.object({}),
    run: () => {
      // A forma real: a mensagem do driver de banco carrega host, porta e
      // configuração de conexão, e o resultado do serviço chega a quem chamou de
      // fora.
      throw new Error("connect ECONNREFUSED 10.0.0.5:5432");
    },
  });

  const res = await servico.execute(sessao(["consultar_saldo"]), {});
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.error.code, "internal");
    assert.doesNotMatch(res.error.message, /ECONNREFUSED|10\.0\.0\.5|5432/);
  }
  // E o detalhe não se perde: vai para o log, que o provedor de deploy coleta.
  assert.equal(registrado.mock.callCount(), 1);
});

test("falha de domínio devolvida pelo serviço atravessa intacta", async () => {
  const servico = defineService({
    name: "ver_recibo",
    summary: "Mostra um recibo.",
    kind: "read",
    permission: "ver_recibo",
    input: z.object({ id: z.string() }),
    run: () => fail("not_found", "Recibo não encontrado."),
  });

  const res = await servico.execute(sessao(["ver_recibo"]), { id: "abc" });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error.code, "not_found");
});

test("serviço sem permissão só existe se estiver declarado na lista", () => {
  // O caso que o teste impede: alguém escreve `permission: null` para destravar o
  // trabalho e ninguém mais repara. As duas situações — público por decisão e
  // público por esquecimento — são idênticas em tempo de execução, e só a
  // declaração as separa.
  assert.throws(
    () =>
      defineService({
        name: "apagar_tudo",
        summary: "Apaga tudo.",
        kind: "write",
        permission: null,
        input: z.object({}),
        run: () => ok(null),
      }),
    /PUBLIC_SERVICES/,
  );
});

test("declarar permissão e estar na lista pública ao mesmo tempo é recusado", () => {
  // As duas declarações se contradizem. Aceitar uma delas em silêncio faria a
  // lista mentir sobre o que é público.
  assert.throws(
    () =>
      defineService({
        name: "ver_perfil",
        summary: "Duplicata contraditória do exemplo.",
        kind: "read",
        permission: "ver_perfil",
        input: z.object({}),
        run: () => ok(null),
      }),
    /contradiz/,
  );
});

test("chave de permissão fora do formato do catálogo é recusada", () => {
  // A permissão vira chave namespaced (`app:<id>:<chave>`) do lado da plataforma.
  // Um espaço ou uma maiúscula corrompe o namespace, e o efeito é uma permissão
  // que nunca casa com nada — uma ação que ninguém consegue executar e cuja causa
  // não aparece em lugar nenhum.
  for (const chave of ["Fechar Mês", "fechar:mes", "", "1_fechar"]) {
    assert.throws(
      () =>
        defineService({
          name: "fechar_mes_2",
          summary: "Fecha o mês.",
          kind: "write",
          permission: chave,
          input: z.object({}),
          run: () => ok(null),
        }),
      /permissão/,
      `deveria recusar a chave ${JSON.stringify(chave)}`,
    );
  }
});

test("serviço sem resumo é recusado", () => {
  // O resumo vira a descrição da tool de MCP. Sem ele, o agente não tem como
  // saber quando usar o serviço — e a tool existe para ser escolhida por um
  // agente, não por quem leu o código.
  assert.throws(
    () =>
      defineService({
        name: "sem_resumo",
        summary: "   ",
        kind: "read",
        permission: "sem_resumo",
        input: z.object({}),
        run: () => ok(null),
      }),
    /resumo/,
  );
});

test("o registro é coerente com o que cada serviço declara", () => {
  for (const [chave, servico] of Object.entries(SERVICES)) {
    // A chave do registro é o nome do serviço: é por esse nome que a tool e o
    // inventário de governança se referem a ele, e uma chave divergente faria
    // `getService(nome)` devolver `undefined` para um serviço que existe.
    assert.equal(chave, servico.name, `registro: a chave ${chave} não é o nome`);
    assert.ok(servico.kind === "read" || servico.kind === "write");
    assert.ok(servico.summary.trim().length > 0);

    if (servico.permission === null) {
      assert.ok(
        PUBLIC_SERVICES.includes(servico.name),
        `${servico.name} não exige permissão e não está em PUBLIC_SERVICES`,
      );
    }
  }
});

test("nenhuma entrada de PUBLIC_SERVICES sobra sem serviço", () => {
  // Entrada obsoleta não é inofensiva: ela fica esperando um serviço futuro com o
  // mesmo nome, que nasceria público sem ninguém decidir isso.
  for (const nome of PUBLIC_SERVICES) {
    const servico = getService(nome);
    assert.ok(
      servico,
      `PUBLIC_SERVICES lista "${nome}", que não é um serviço registrado`,
    );
    assert.equal(
      servico.permission,
      null,
      `"${nome}" está na lista pública mas exige permissão`,
    );
  }
});

test("getService só devolve serviço registrado, nunca herdado", () => {
  // O nome vem de FORA: a rota — e, adiante, a tool que o agente chama — pede o
  // serviço pelo nome que recebeu. Sem a checagem de propriedade própria,
  // `getService("toString")` devolveria a função herdada de `Object.prototype`:
  // passa por qualquer teste de "achou?" e estoura no `execute` que não existe.
  for (const herdado of ["toString", "constructor", "hasOwnProperty", "__proto__"]) {
    assert.equal(
      getService(herdado),
      undefined,
      `getService(${JSON.stringify(herdado)}) devolveu algo que não é um serviço`,
    );
  }
  assert.ok(getService("ver_perfil"), "o serviço registrado continua sendo achado");
});

test("a camada de serviço não conhece HTTP", () => {
  // É o que permite a mesma decisão servir a tela, a rota e a tool: um serviço que
  // devolva resposta HTTP só serve à porta para a qual foi escrito, e a próxima
  // porta ganha uma segunda implementação da regra.
  const pasta = path.join(import.meta.dirname, "..", "lib", "services");
  // As aspas são as duas: o `prettier` normaliza para aspas duplas, mas um teste
  // que só enxerga o que a formatação produz deixa de enxergar justamente o
  // arquivo que chegou torto — e este teste existe para o caso em que algo passou.
  const proibidos: [RegExp, string][] = [
    [
      /from\s+['"]next\//,
      "importar de `next/` traz o pedido HTTP para dentro da regra",
    ],
    [/\bNextResponse\b/, "resposta HTTP é trabalho da rota"],
    [/\bResponse\.json\(/, "resposta HTTP é trabalho da rota"],
    [/new\s+Response\(/, "resposta HTTP é trabalho da rota"],
    [/from\s+['"]\.\.\/\.\.\/app\//, "serviço não depende de rota nem de página"],
  ];

  const arquivos = readdirSync(pasta).filter((nome) => nome.endsWith(".ts"));
  assert.ok(arquivos.length > 0, "não achei os arquivos de lib/services");

  for (const arquivo of arquivos) {
    const conteudo = readFileSync(path.join(pasta, arquivo), "utf8");
    for (const [padrao, motivo] of proibidos) {
      assert.doesNotMatch(conteudo, padrao, `lib/services/${arquivo}: ${motivo}`);
    }
  }
});
