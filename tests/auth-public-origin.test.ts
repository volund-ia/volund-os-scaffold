// A origem pública da requisição — o defeito que impedia QUALQUER login atrás
// de um proxy reverso.
//
// Medido em produção em 02/08/2026, num App recém-criado: o `redirect_uri`
// enviado ao provedor era `http://localhost:3000/api/auth/callback`, enquanto o
// registrado era `https://<host-público>/api/auth/callback`. A plataforma
// recusou — corretamente, porque a comparação é por igualdade exata (RFC 9700).
// A tentativa de entrar morria em "endereço de retorno não registrado", com o
// dedo apontado para o registro, que estava certo.
//
// A causa: `callbackUriFor(request.url)`. Atrás do proxy, `request.url` traz a
// origem INTERNA. O `proxy.ts` já usava `request.nextUrl` (que respeita
// `x-forwarded-host`) e por isso redirecionava para o host certo — as duas
// fontes discordavam dentro da mesma cadeia de requisição.
//
// Rodar: npm test
import assert from "node:assert/strict";
import { test } from "node:test";

import { callbackUriFor, publicOriginFor } from "../lib/auth/session";

const req = (url: string, headers: Record<string, string> = {}): Request =>
  new Request(url, { headers });

// ---------------------------------------------------------------------------
// O caso que quebrava
// ---------------------------------------------------------------------------

test("atrás do proxy, a origem é a PÚBLICA e não a interna", () => {
  const origem = publicOriginFor(
    req("http://localhost:3000/api/auth/login", {
      "x-forwarded-host": "3000-abc123.e2b.app",
      "x-forwarded-proto": "https",
      host: "localhost:3000",
    }),
  );

  assert.equal(origem, "https://3000-abc123.e2b.app");
  assert.equal(
    callbackUriFor(origem),
    "https://3000-abc123.e2b.app/api/auth/callback",
    "é este valor que a plataforma registra e compara por igualdade exata",
  );
});

test("sem proxy, o comportamento não muda", () => {
  // Desenvolvimento local direto: nada de forwarded, e a origem é a do pedido.
  assert.equal(
    publicOriginFor(req("http://localhost:3000/api/auth/login", { host: "localhost:3000" })),
    "http://localhost:3000",
  );
  assert.equal(
    callbackUriFor(publicOriginFor(req("http://localhost:3000/x", { host: "localhost:3000" }))),
    "http://localhost:3000/api/auth/callback",
  );
});

test("a cadeia de `x-forwarded-host` usa o PRIMEIRO", () => {
  // Com mais de um proxy o header vem como `a, b, c`. O primeiro é quem o
  // navegador falou; os demais são saltos internos.
  assert.equal(
    publicOriginFor(
      req("http://localhost:3000/", {
        "x-forwarded-host": "app.exemplo.com, interno-1, interno-2",
        "x-forwarded-proto": "https, http",
      }),
    ),
    "https://app.exemplo.com",
  );
});

// ---------------------------------------------------------------------------
// O header é falsificável — o que ele NÃO pode fazer
// ---------------------------------------------------------------------------

test("`x-forwarded-proto: http` forjado NÃO rebaixa um host público", () => {
  // Este é o limite que separa "usar o header" de "confiar no header". Se ele
  // pudesse impor `http`, bastaria um pedido forjado para a aplicação passar a
  // servir o cookie de sessão sem `Secure` — e aí o header vira ferramenta de
  // downgrade em vez de informação de roteamento.
  assert.equal(
    publicOriginFor(
      req("https://app.exemplo.com/", {
        "x-forwarded-host": "app.exemplo.com",
        "x-forwarded-proto": "http",
      }),
    ),
    "https://app.exemplo.com",
  );
});

test("host forjado produz autorização RECUSADA, não redirecionamento", () => {
  // A segunda contenção: mesmo que alguém injete um host, o `redirect_uri`
  // derivado dele é conferido pelo PROVEDOR contra a lista registrada. O
  // resultado é uma recusa — nunca um código de autorização entregue noutro
  // lugar. O teste fixa a forma para deixar claro o que sai daqui.
  const origem = publicOriginFor(
    req("http://localhost:3000/", { "x-forwarded-host": "atacante.example" }),
  );
  assert.equal(callbackUriFor(origem), "https://atacante.example/api/auth/callback");
});

test("host malformado cai de volta para a origem do pedido", () => {
  assert.equal(
    publicOriginFor(req("http://localhost:3000/", { "x-forwarded-host": "  " })),
    "http://localhost:3000",
  );
});

test("localhost encaminhado mantém http", () => {
  // Um proxy local (docker, túnel) continua servindo em texto claro, e forçar
  // `https` aqui quebraria o desenvolvimento sem ganhar nada.
  assert.equal(
    publicOriginFor(
      req("http://127.0.0.1:3000/", {
        "x-forwarded-host": "localhost:3000",
        "x-forwarded-proto": "http",
      }),
    ),
    "http://localhost:3000",
  );
});
