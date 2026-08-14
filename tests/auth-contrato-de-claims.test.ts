// A ponta do SCAFFOLD do contrato de claims — o que a aplicação CONSOME.
//
// ## Por que este teste existe
//
// Este arquivo lia `claims.email` do access token. O provedor nunca emitia esse
// claim. Os dois lados estavam internamente coerentes, os dois tinham teste, e
// nenhum teste falhava: `session.email` chegava `null` para todo mundo, em todo
// App, por dois marcos inteiros.
//
// O defeito só apareceu quando um agente construiu a regra de acesso de um App
// em cima desse campo — e o App inteiro ficou trancado, inclusive para quem o
// criou. Precisou de um teste manual em produção para descobrir.
//
// O gêmeo deste arquivo, na plataforma, confere a EMISSÃO contra a mesma
// descrição em `contracts/auth-claims.json`. Aqui se confere o CONSUMO.
//
// Rodar: npm test
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import type { TokenClaims } from "../lib/auth/jwt";

/**
 * O diretório deste arquivo, derivado da URL do módulo.
 *
 * `aquiDir` só existe a partir do Node 20.11, e o `.nvmrc` fixa
 * 20.9.0 — nele o valor é `undefined` e o `path.join` estoura. Isso nunca
 * apareceu porque o CI rodava ZERO testes (o glob padrão do Node 20 não casa
 * `tests/*.test.ts`); quando ele passou a rodá-los, cinco arquivos quebraram
 * de uma vez. Esta forma funciona em qualquer versão.
 */
const aquiDir = path.dirname(fileURLToPath(import.meta.url));

const root = path.join(aquiDir, "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

interface ClaimsContract {
  contract: number;
  accessToken: { always: string[]; scoped: Record<string, string> };
  session: Record<string, string>;
}

const contract = JSON.parse(read("contracts/auth-claims.json")) as ClaimsContract;

/**
 * O trecho entre dois marcos, exigindo que os DOIS existam.
 *
 * `slice(a, b)` com `b < a` devolve string vazia, e asserção sobre string vazia
 * passa calada.
 */
function sliceBetween(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  assert.notEqual(start, -1, `marco inicial não encontrado: ${from}`);
  const end = source.indexOf(to, start + from.length);
  assert.notEqual(end, -1, `marco final não encontrado: ${to}`);
  return source.slice(start, end);
}

/**
 * Um access token como o provedor o emite, montado A PARTIR DO CONTRATO.
 *
 * Escrever os claims à mão aqui seria escrever a expectativa duas vezes — e a
 * cópia local envelheceria sem ninguém notar, que é exatamente o modo de falhar
 * que este arquivo existe para fechar.
 */
function claimsFromContract(): TokenClaims {
  const value: Record<string, unknown> = {
    iss: "https://os.volund.com.br",
    sub: "user-1",
    aud: "volund:app:app-1",
    exp: Math.floor(Date.now() / 1000) + 600,
    iat: Math.floor(Date.now() / 1000),
    azp: "volund_app_abc",
    app_id: "app-1",
    org_id: "org-1",
    scope: "openid profile email volund.permissions",
    roles: ["admin"],
    permissions: ["app:app-1:algo"],
    email: "pessoa@exemplo.com.br",
    name: "Pessoa Exemplo",
  };

  // Só o que o contrato descreve. Um claim a mais aqui esconderia a ausência do
  // claim de verdade.
  const permitidos = new Set([
    ...contract.accessToken.always,
    ...Object.keys(contract.accessToken.scoped),
    "exp",
    "iat",
  ]);
  for (const key of Object.keys(value)) {
    if (!permitidos.has(key)) delete value[key];
  }
  // `as unknown as` porque o objeto é montado a partir do CONTRATO, não do tipo:
  // é justamente a divergência entre os dois que este arquivo existe para
  // encontrar, e um `as` direto exigiria que ele já casasse com `TokenClaims`.
  return value as unknown as TokenClaims;
}

/**
 * O mapeamento que `readSession` faz dos claims para a sessão.
 *
 * Reproduzido aqui, e não importado, porque `readSession` precisa de rede (JWKS)
 * e de um cookie selado. O que este teste guarda é o mapeamento — e ele tem um
 * teste próprio garantindo que a cópia não divergiu do original.
 */
function sessionFromClaims(claims: TokenClaims) {
  return {
    userId: claims.sub,
    orgId: claims.org_id ?? "",
    appId: claims.app_id ?? "",
    email: claims.email ?? null,
    name: claims.name ?? null,
    roles: Array.isArray(claims.roles) ? claims.roles : [],
    permissions: Array.isArray(claims.permissions) ? claims.permissions : [],
  };
}

test("o contrato cobre TODOS os campos da sessão, sem sobra dos dois lados", () => {
  // Sem esta igualdade, o contrato poderia ser estreitado e a guarda sumiria
  // junto: tirar `email` do contrato faria os laços abaixo pararem de exigi-lo,
  // enquanto `readSession` continuaria consumindo `claims.email`. O campo
  // voltaria a chegar nulo com a suíte verde — que é exatamente o desfecho que
  // este arquivo existe para tornar impossível.
  const session = sessionFromClaims(claimsFromContract());

  assert.deepEqual(
    Object.keys(session).sort(),
    Object.keys(contract.session).sort(),
    "campo da sessão fora do contrato (ou contrato prometendo campo que a sessão não tem)",
  );
});

test("todo campo da sessão chega preenchido a partir dos claims do contrato", () => {
  // A asserção que teria pego o defeito no dia: cada campo que a aplicação
  // enxerga precisa ter origem num claim que o provedor emite de verdade.
  const session = sessionFromClaims(claimsFromContract()) as Record<string, unknown>;

  for (const [field, claim] of Object.entries(contract.session)) {
    const value = session[field];
    const vazio =
      value == null || value === "" || (Array.isArray(value) && value.length === 0);
    assert.ok(
      !vazio,
      `\`session.${field}\` saiu vazio — o claim \`${claim}\` que deveria alimentá-lo não chegou`,
    );
  }
});

test("o mapeamento testado aqui é o MESMO de `readSession`", () => {
  // Sem esta guarda, a cópia acima viraria decoração: `readSession` poderia
  // mudar e este arquivo continuaria aprovando o mapeamento antigo.
  // Recorte limitado ao CORPO de `readSession`: até o fim do arquivo, uma
  // ocorrência posterior de `campo: claims.x` — noutra função — aprovaria a
  // asserção sem que `readSession` fizesse nada disso.
  const src = read("lib/auth/session.ts");
  const bloco = sliceBetween(
    src,
    "export async function readSession",
    "export function needsRefresh",
  );

  for (const [field, claim] of Object.entries(contract.session)) {
    const esperado = new RegExp(`${field}:\\s*(Array\\.isArray\\()?claims\\.${claim}`);
    assert.match(
      bloco,
      esperado,
      `\`readSession\` deixou de montar \`${field}\` a partir de \`claims.${claim}\``,
    );
  }
});

test("o tipo dos claims declara tudo o que o contrato promete", () => {
  // `TokenClaims` é o que o resto da aplicação enxerga. Um claim ausente dele
  // seria descartado na leitura mesmo chegando no token.
  const src = read("lib/auth/jwt.ts");
  const bloco = src.slice(
    src.indexOf("export interface TokenClaims"),
    src.indexOf("export type VerifyResult"),
  );

  for (const claim of [
    ...contract.accessToken.always,
    ...Object.keys(contract.accessToken.scoped),
  ]) {
    assert.match(
      bloco,
      new RegExp(`\\b${claim}\\??:`),
      `\`TokenClaims\` não declara \`${claim}\``,
    );
  }
});

test("o contrato pertence ao contrato de scaffold desta aplicação", () => {
  // A amarração que transforma "mudei os claims" num ato coordenado entre os
  // dois repositórios: a plataforma recusa scaffold cujo contrato ela não
  // suporta, então mexer nos claims sem subir o número não tem trava nenhuma.
  const manifest = JSON.parse(read("volund-scaffold.json")) as { contract: number };
  assert.equal(contract.contract, manifest.contract);
});

test("os escopos pedidos cobrem os claims que o contrato condiciona", () => {
  // Se a aplicação parar de pedir `email`, o provedor para de emitir o claim — e
  // o campo volta a chegar nulo, sem nada quebrar do lado de lá. O defeito
  // renasceria por esta porta.
  // Mesma razão: só a declaração de `AUTH_SCOPES`. Um `"email"` solto mais
  // abaixo no arquivo passaria por escopo pedido.
  const src = read("lib/auth/config.ts");
  const bloco = sliceBetween(src, "export const AUTH_SCOPES", "] as const;");

  for (const scope of new Set(Object.values(contract.accessToken.scoped))) {
    assert.match(
      bloco,
      new RegExp(`"${scope}"`),
      `a aplicação precisa pedir o escopo \`${scope}\``,
    );
  }
});
