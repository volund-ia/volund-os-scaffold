// O callback do OIDC roda SEM sessão — é ele quem a estabelece. O que este
// arquivo prova é que ele *responde* nessa condição (em vez de ser mandado para
// o login, que é o laço que a allow-list existe para evitar) e que responder não
// é o mesmo que aceitar qualquer coisa.
import assert from "node:assert/strict";
import { test } from "node:test";

import { GET } from "../app/api/auth/callback/route";
import type { AuthConfig } from "../lib/auth/config";
import { sealHandshake } from "../lib/auth/session";

const AMBIENTE = {
  VOLUND_OIDC_ISSUER: "https://provedor.exemplo.test",
  VOLUND_OIDC_CLIENT_ID: "client-de-teste",
  VOLUND_OIDC_CLIENT_SECRET: "segredo-de-teste",
  VOLUND_APP_ID: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
};

/**
 * Roda `fn` com o ambiente trocado e restaura depois.
 *
 * `await fn()` e não `fn()`: sem o `await`, o `finally` roda quando o handler
 * DEVOLVE a promessa, não quando ela resolve — e o ambiente voltaria ao normal
 * com o handler ainda em execução. Hoje passaria por sorte (a leitura da
 * configuração acontece antes do primeiro `await` interno); no dia em que a
 * ordem interna mudasse, o teste de 503 leria o ambiente restaurado e deixaria
 * de verificar o que diz verificar.
 */
async function comAmbiente<T>(
  vars: Record<string, string | undefined>,
  fn: () => T | Promise<T>,
): Promise<T> {
  const anterior: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    anterior[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
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

test("state divergente é recusado, mesmo com aperto de mão válido", async () => {
  // É o que amarra a resposta ao pedido que ESTE navegador iniciou. Sem a
  // conferência, um código obtido em outro contexto viraria sessão aqui.
  const config: AuthConfig = {
    issuer: AMBIENTE.VOLUND_OIDC_ISSUER,
    clientId: AMBIENTE.VOLUND_OIDC_CLIENT_ID,
    clientSecret: AMBIENTE.VOLUND_OIDC_CLIENT_SECRET,
    appId: AMBIENTE.VOLUND_APP_ID,
  };
  const selado = await sealHandshake(
    {
      state: "o-state-que-eu-sorteei",
      nonce: "n",
      codeVerifier: "v",
      redirectUri: "https://app.exemplo.test/api/auth/callback",
      returnTo: "/painel",
      expiresAt: Date.now() + 60_000,
    },
    config,
  );

  const res = await comAmbiente(AMBIENTE, () =>
    GET(pedido("?code=abc&state=outro-state", `volund_auth_handshake=${selado}`)),
  );
  assert.equal(res.status, 400);
  const body = (await res.json()) as { motivo: string };
  assert.match(body.motivo, /não confere/);
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
