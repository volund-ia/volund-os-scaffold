// O callback do OIDC roda SEM sessão — é ele quem a estabelece. O que este
// arquivo prova é que ele *responde* nessa condição (em vez de ser mandado para
// o login, que é o laço que a allow-list existe para evitar) e que responder não
// é o mesmo que aceitar qualquer coisa.
import assert from "node:assert/strict";
import { test } from "node:test";

import { GET } from "../app/api/auth/callback/route";

const AMBIENTE = {
  VOLUND_OIDC_ISSUER: "https://provedor.exemplo.test",
  VOLUND_OIDC_CLIENT_ID: "client-de-teste",
  VOLUND_OIDC_CLIENT_SECRET: "segredo-de-teste",
};

function comAmbiente<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const anterior: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    anterior[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(anterior)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function pedido(query: string, cookie?: string): Request {
  return new Request(`https://app.exemplo.test/api/auth/callback${query}`, {
    headers: cookie ? { cookie } : {},
  });
}

test("responde sem sessão, em vez de ser redirecionado ao login", async () => {
  // Sem o cookie do aperto de mão não há como concluir — mas a resposta sai
  // daqui. Se esta rota exigisse sessão, o provedor devolveria o usuário e o
  // portão o mandaria de volta ao login, em círculo.
  const res = await comAmbiente(AMBIENTE, () => GET(pedido("?code=abc&state=xyz")));
  assert.equal(res.status, 400);
  const body = (await res.json()) as { motivo: string };
  assert.match(body.motivo, /não encontrado ou expirado/);
});

test("apaga o aperto de mão ao recusar", async () => {
  const res = await comAmbiente(AMBIENTE, () => GET(pedido("?code=abc&state=xyz")));
  // Deixá-lo vivo daria uma segunda chance a quem estivesse testando `state`.
  assert.match(res.headers.get("set-cookie") ?? "", /volund_auth_handshake=;/);
});

test("resposta incompleta do provedor é recusada", async () => {
  for (const query of ["", "?code=abc", "?state=xyz"]) {
    const res = await comAmbiente(AMBIENTE, () => GET(pedido(query)));
    assert.equal(res.status, 400);
  }
});

test("erro devolvido pelo provedor não é ecoado para o navegador", async () => {
  const res = await comAmbiente(AMBIENTE, () =>
    GET(pedido("?error=access_denied&error_description=texto+vindo+de+fora")),
  );
  assert.equal(res.status, 403);
  const body = (await res.json()) as { motivo: string };
  assert.doesNotMatch(body.motivo, /texto vindo de fora/);
});

test("sem configuração, falha nomeando a variável — e não abre nada", async () => {
  const res = await comAmbiente(
    { ...AMBIENTE, VOLUND_OIDC_CLIENT_SECRET: undefined },
    () => GET(pedido("?code=abc&state=xyz")),
  );
  assert.equal(res.status, 503);
  const body = (await res.json()) as { variavel: string };
  assert.equal(body.variavel, "VOLUND_OIDC_CLIENT_SECRET");
});
