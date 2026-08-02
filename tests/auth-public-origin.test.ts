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
    publicOriginFor(
      req("http://localhost:3000/api/auth/login", { host: "localhost:3000" }),
    ),
    "http://localhost:3000",
  );
  assert.equal(
    callbackUriFor(
      publicOriginFor(req("http://localhost:3000/x", { host: "localhost:3000" })),
    ),
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

test("`x-forwarded-proto` forjado não muda nada — ele nem é lido", () => {
  // Este é o limite que separa "usar o header" de "confiar no header". Se o
  // esquema saísse de `x-forwarded-proto`, bastaria um pedido forjado com
  // `http` para a aplicação servir o cookie de sessão sem `Secure` — e o header
  // viraria ferramenta de downgrade em vez de informação de roteamento.
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

test("`x-forwarded-host: localhost` forjado NÃO tira o `Secure`", () => {
  // O caso que a revisão pegou, e que a primeira versão desta correção errava:
  // `isSecureRequest` abre exceção para `localhost`, então bastava forjar o HOST
  // como localhost para a origem virar `http://localhost` e o cookie de um site
  // HTTPS real sair sem `Secure`. Nem era preciso forjar o proto junto — atrás
  // de um proxy que termina TLS, o esquema interno já é `http`.
  //
  // Antes da correção o valor vinha de `request.url`, que nenhum header
  // alcança. Ou seja: a primeira versão PIOROU esta aresta enquanto consertava
  // a outra. Agora, com proxy presente, o esquema é `https` sempre — forjar só
  // consegue LIGAR o `Secure`.
  const casos: Array<Record<string, string>> = [
    { "x-forwarded-host": "localhost" },
    { "x-forwarded-host": "localhost:3000", "x-forwarded-proto": "http" },
    { "x-forwarded-host": "127.0.0.1", "x-forwarded-proto": "http" },
  ];
  for (const headers of casos) {
    const origem = publicOriginFor(req("http://localhost:3000/", headers));
    assert.match(origem, /^https:/, `esperava https para ${JSON.stringify(headers)}`);
  }
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

test("sem proxy, localhost continua em http", () => {
  // O desenvolvimento local direto (`npm run dev`) não manda header nenhum, e é
  // este caso que precisa continuar sem `Secure` — senão o cookie não sobe.
  assert.equal(
    publicOriginFor(req("http://localhost:3000/", { host: "localhost:3000" })),
    "http://localhost:3000",
  );
  assert.equal(publicOriginFor(req("http://127.0.0.1:3000/")), "http://127.0.0.1:3000");
});
