// A rota é a terceira porta da mesma decisão — e é a porta que a TELA usa.
//
// O que estes testes vigiam não é "a rota responde": é que ela **traduz** e não
// decide. Uma rota que confira permissão por conta própria funciona no dia em
// que foi escrita e passa a divergir do serviço na primeira mudança, sem dar
// erro — respondendo diferente da tela para a mesma pergunta.
//
// Cobre também a tradução da taxonomia inteira para status HTTP. Escrita rota
// por rota, essa correspondência erra: uma devolve 400 onde outra devolve 422,
// outra esquece o 409 e responde 500, e o cliente que fala com as duas passa a
// precisar saber com qual está falando.
//
// Os casos de validação de entrada do antigo `tests/api-echo.test.ts` vivem
// aqui: a regra que era da rota virou o serviço `ecoar`, e a rota que sobrou não
// tem o que testar sozinha.
//
// Rodar: npm test
import assert from "node:assert/strict";
import { test } from "node:test";

import { z } from "zod";

import type { Session } from "../lib/auth/session";
import {
  HTTP_STATUS_BY_ERROR_CODE,
  serviceResponse,
  serviceRoute,
} from "../lib/http/service-route";
import { getTool } from "../lib/mcp/tools";
import { defineService } from "../lib/services/define";
import { ecoar } from "../lib/services/eco";
import { verDiagnostico } from "../lib/services/painel";
import { fail, ok, type ServiceErrorCode } from "../lib/services/types";

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

/** Sessão injetada: `getSession()` depende do contexto de requisição do Next. */
const comSessao =
  (permissoes: string[] = []) =>
  async () =>
    sessao(permissoes);
const semSessao = async () => null;

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/echo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const rotaEco = (permissoes: string[] = []) =>
  serviceRoute(ecoar, { from: "json", readSession: comSessao(permissoes) });

test("a tabela de status cobre a taxonomia inteira", () => {
  // `satisfies` já reprova em tempo de compilação um código sem status. Este
  // teste vigia o outro lado: o status de cada código continua sendo o certo.
  const esperado: Record<ServiceErrorCode, number> = {
    unauthenticated: 401,
    forbidden: 403,
    invalid_input: 400,
    not_found: 404,
    conflict: 409,
    internal: 500,
  };
  assert.deepEqual(HTTP_STATUS_BY_ERROR_CODE, esperado);

  for (const [codigo, status] of Object.entries(esperado)) {
    const res = serviceResponse(fail(codigo as ServiceErrorCode, "mensagem"));
    assert.equal(res.status, status, `${codigo} deveria virar ${status}`);
  }
});

test("sucesso devolve o dado direto, sem envelope", async () => {
  const res = serviceResponse(ok({ id: "abc" }));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.deepEqual(await res.json(), { id: "abc" });
});

test("aceita corpo válido e devolve o eco", async () => {
  const res = await rotaEco()(jsonRequest({ mensagem: "olá", repetir: 3 }));
  assert.equal(res.status, 200);
  const data = (await res.json()) as { eco: string[] };
  assert.deepEqual(data.eco, ["olá", "olá", "olá"]);
});

test("repetir é opcional e cai em 1", async () => {
  const res = await rotaEco()(jsonRequest({ mensagem: "só uma vez" }));
  const data = (await res.json()) as { eco: string[] };
  assert.deepEqual(data.eco, ["só uma vez"]);
});

test("recusa corpo inválido com 400 e diz qual campo falhou", async () => {
  const res = await rotaEco()(jsonRequest({ mensagem: "" }));
  assert.equal(res.status, 400);
  const data = (await res.json()) as { codigo: string; detalhes?: string[] };
  assert.equal(data.codigo, "invalid_input");
  assert.ok(
    data.detalhes?.some((problema) => problema.startsWith("mensagem:")),
    `esperava um problema apontando o campo; veio ${JSON.stringify(data.detalhes)}`,
  );
});

test("recusa tipo errado sem estourar exceção", async () => {
  const res = await rotaEco()(jsonRequest({ mensagem: "ok", repetir: "três" }));
  assert.equal(res.status, 400);
});

test("recusa JSON malformado com mensagem própria", async () => {
  // Corpo que não é JSON nem chega a ser uma entrada — "dados inválidos"
  // mandaria quem chamou procurar o campo errado.
  const res = await rotaEco()(
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

test("sem sessão a rota responde 401, e a decisão é do serviço", async () => {
  const rota = serviceRoute(ecoar, { from: "json", readSession: semSessao });
  const res = await rota(jsonRequest({ mensagem: "olá" }));
  assert.equal(res.status, 401);
  const data = (await res.json()) as { codigo: string };
  assert.equal(data.codigo, "unauthenticated");
});

test("a rota recusa quem o can() recusa, e diz qual permissão falta", async () => {
  const rota = (permissoes: string[]) =>
    serviceRoute(verDiagnostico, {
      from: "query",
      readSession: comSessao(permissoes),
    });
  const pedido = new Request("http://localhost:3000/api/diagnostico");

  const negado = await rota([])(pedido);
  assert.equal(negado.status, 403);
  const erro = (await negado.json()) as { codigo: string; permissao?: string };
  assert.equal(erro.codigo, "forbidden");
  // É o que permite a tela dizer o que pedir a quem administra, em vez de
  // repetir a permissão numa segunda lista que vai divergir na renomeação.
  assert.equal(erro.permissao, "ver_diagnostico");

  const permitido = await rota(["ver_diagnostico"])(pedido);
  assert.equal(permitido.status, 200);
});

test("entrada de rota GET vem dos parâmetros de query", async () => {
  const buscar = defineService({
    name: "buscar_registro",
    summary: "Busca um registro pelo termo.",
    kind: "read",
    permission: "buscar_registro",
    input: z.object({ termo: z.string().min(1) }),
    run: (_session, input) => ok({ encontrado: input.termo }),
  });
  const rota = serviceRoute(buscar, {
    from: "query",
    readSession: comSessao(["buscar_registro"]),
  });

  const res = await rota(new Request("http://localhost:3000/api/buscar?termo=sala+3"));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { encontrado: "sala 3" });

  const semTermo = await rota(new Request("http://localhost:3000/api/buscar"));
  assert.equal(semTermo.status, 400);
});

test("na query, valor é texto e chave repetida fica só com a última", async () => {
  // Os dois limites documentados em `ServiceRouteOptions.from`, exercitados para
  // que a documentação não vire promessa: quem escreve o serviço descobriria
  // isto em tempo de execução, com um 400 aparentemente inexplicável.
  const comNumeroCru = defineService({
    name: "paginar_cru",
    summary: "Recebe um número sem coerção.",
    kind: "read",
    permission: "paginar_cru",
    input: z.object({ pagina: z.number() }),
    run: (_session, input) => ok(input),
  });
  const rotaCrua = serviceRoute(comNumeroCru, {
    from: "query",
    readSession: comSessao(["paginar_cru"]),
  });
  const recusado = await rotaCrua(new Request("http://localhost:3000/api/x?pagina=2"));
  assert.equal(recusado.status, 400, "`z.number()` não aceita o texto da query");

  // O caminho certo é a coerção no schema do PRÓPRIO serviço.
  const comCoercao = defineService({
    name: "paginar",
    summary: "Recebe um número com coerção.",
    kind: "read",
    permission: "paginar",
    input: z.object({ pagina: z.coerce.number().int().min(1) }),
    run: (_session, input) => ok(input),
  });
  const rota = serviceRoute(comCoercao, {
    from: "query",
    readSession: comSessao(["paginar"]),
  });
  const aceito = await rota(new Request("http://localhost:3000/api/x?pagina=2"));
  assert.equal(aceito.status, 200);
  assert.deepEqual(await aceito.json(), { pagina: 2 });

  // Chave repetida: vale a última. Rota que precise de lista escreve o handler à
  // mão e chama o serviço com o array pronto.
  const comTexto = defineService({
    name: "filtrar",
    summary: "Recebe uma etiqueta.",
    kind: "read",
    permission: "filtrar",
    input: z.object({ tag: z.string() }),
    run: (_session, input) => ok(input),
  });
  const rotaTag = serviceRoute(comTexto, {
    from: "query",
    readSession: comSessao(["filtrar"]),
  });
  const repetida = await rotaTag(
    new Request("http://localhost:3000/api/x?tag=a&tag=b"),
  );
  assert.deepEqual(await repetida.json(), { tag: "b" });
});

test("a mesma entrada pela rota e pela tool produz o mesmo efeito", async () => {
  // O teste que dá sentido às três portas. Se um dia a rota ganhar um default
  // próprio, um limite próprio ou uma normalização própria, é aqui que aparece.
  const entrada = { mensagem: "mesma decisão", repetir: 2 };

  const respostaDaRota = await rotaEco()(jsonRequest(entrada));
  const pelaRota = (await respostaDaRota.json()) as { eco: string[] };

  const tool = getTool("ecoar");
  assert.ok(tool, "a tool de exemplo precisa estar registrada");
  const resultado = await tool.call(sessao(), entrada);
  assert.equal(resultado.ok, true);

  if (resultado.ok) {
    const pelaTool = resultado.data as { eco: string[] };
    // `recebidoEm` é o instante da chamada e difere entre as duas por desenho.
    assert.deepEqual(pelaRota.eco, pelaTool.eco);
  }
});

test("falha interna vira 500 sem contar o que aconteceu", async (t) => {
  const registrado = t.mock.method(console, "error", () => {});
  const explode = defineService({
    name: "consultar_extrato",
    summary: "Consulta o extrato.",
    kind: "read",
    permission: "consultar_extrato",
    input: z.object({}),
    run: () => {
      throw new Error("connect ECONNREFUSED 10.0.0.5:5432");
    },
  });
  const rota = serviceRoute(explode, {
    from: "query",
    readSession: comSessao(["consultar_extrato"]),
  });

  const res = await rota(new Request("http://localhost:3000/api/extrato"));
  assert.equal(res.status, 500);
  const corpo = await res.text();
  assert.doesNotMatch(corpo, /ECONNREFUSED|10\.0\.0\.5|5432/);
  assert.equal(registrado.mock.callCount(), 1);
});
