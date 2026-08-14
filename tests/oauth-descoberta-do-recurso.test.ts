// A descoberta que abre o fluxo padrão de autorização do MCP.
//
// Este App já era um recurso protegido correto: `Authorization: Bearer`, mesma
// verificação da sessão web, audiência por App. O que faltava era ele DIZER isso
// de um jeito que um cliente qualquer entenda — e a spec (2025-06-18) define
// exatamente como: o 401 aponta para o metadado (RFC 9728), e o metadado aponta
// para o servidor de autorização.
//
// Sem essas duas coisas, um cliente que não conhece o VolundOS só sabe que
// falhou. Foi o que aconteceu quando um agente tentou conectar: 401 sem
// `resource_metadata`, e o metadado — quando alguém pensou em procurá-lo —
// respondendo 401 também, porque estava atrás do portão de cookie.
//
// Rodar (precisa de build para a última asserção): npm run check
import assert from "node:assert/strict";
import { test } from "node:test";

import { MCP_PATH, PROTECTED_RESOURCE_METADATA_PATH } from "../lib/auth/config";
import { isPublicRoute, PUBLIC_ROUTES } from "../lib/auth/route-policy";

const ORIGEM = "https://app-de-teste.example.com";

/** O `WWW-Authenticate` que o portão emite, sem subir servidor. */
async function desafioDe(url: string): Promise<string | null> {
  // Sem env de autenticação o portão devolve 503 — que não carrega o desafio.
  // Estas três variáveis não precisam ser reais: o teste para antes de verificar
  // token nenhum, na ausência do cabeçalho.
  process.env.VOLUND_OIDC_ISSUER ??= "https://os.volund.com.br";
  process.env.VOLUND_OIDC_CLIENT_ID ??= "volund_app_teste";
  process.env.VOLUND_OIDC_CLIENT_SECRET ??= "segredo-de-teste";

  const { bearerGate } = await import("../lib/auth/server");
  const gate = await bearerGate(new Request(url));
  assert.equal(gate.ok, false, "sem cabeçalho o portão tem de recusar");
  if (gate.ok) return null;
  assert.equal(gate.response.status, 401);
  return gate.response.headers.get("www-authenticate");
}

test("o 401 aponta para o metadado, na origem de quem chamou", async () => {
  const desafio = await desafioDe(`${ORIGEM}${MCP_PATH}`);

  assert.ok(desafio, "recusa 401 sem `WWW-Authenticate` não diz como se autenticar");
  assert.match(
    desafio,
    /^Bearer /,
    "o esquema vem primeiro; um cliente que faz parsing estrito recusa o resto",
  );
  assert.ok(
    desafio.includes(
      `resource_metadata="${ORIGEM}${PROTECTED_RESOURCE_METADATA_PATH}"`,
    ),
    "sem `resource_metadata` o cliente não tem por onde começar a descoberta — " +
      `veio: ${desafio}`,
  );
});

test("a origem sai da requisição, não de configuração", async () => {
  // O mesmo App responde em produção, na pré-visualização e no ambiente ao vivo.
  // Um endereço fixo mandaria o cliente descobrir noutro lugar do que aquele em
  // que ele estava falando — e o metadado de lá pode nem existir.
  const outra = "https://3000-abc123.e2b.app";
  const desafio = await desafioDe(`${outra}${MCP_PATH}`);
  assert.ok(
    desafio?.includes(
      `resource_metadata="${outra}${PROTECTED_RESOURCE_METADATA_PATH}"`,
    ),
  );
});

test("o metadado é público — e é o caminho da spec que está na lista", () => {
  assert.ok(
    isPublicRoute(PROTECTED_RESOURCE_METADATA_PATH),
    "metadado de descoberta atrás do portão de cookie responde 401, e a " +
      "descoberta morre no primeiro passo com o documento pronto do outro lado",
  );
  assert.ok(
    PUBLIC_ROUTES.includes(PROTECTED_RESOURCE_METADATA_PATH),
    "a lista é comparada por igualdade exata: não há herança por prefixo",
  );
  // O caminho PÚBLICO, não o do handler: o proxy vê o pathname antes do rewrite.
  assert.ok(
    !PUBLIC_ROUTES.includes("/api/oauth-protected-resource"),
    "enumerar o caminho interno não torna o público acessível, e abriria um " +
      "endereço a mais sem necessidade",
  );
});

test("o documento descreve ESTE recurso e aponta o provedor", async () => {
  process.env.VOLUND_OIDC_ISSUER = "https://os.volund.com.br";
  process.env.VOLUND_OIDC_CLIENT_ID ??= "volund_app_teste";
  process.env.VOLUND_OIDC_CLIENT_SECRET ??= "segredo-de-teste";

  const { GET } = await import("../app/api/oauth-protected-resource/route");
  const res = await GET(new Request(`${ORIGEM}${PROTECTED_RESOURCE_METADATA_PATH}`));
  assert.equal(res.status, 200);

  const doc = (await res.json()) as Record<string, unknown>;
  assert.equal(
    doc.resource,
    `${ORIGEM}${MCP_PATH}`,
    "o `resource` é a URL canônica do endpoint MCP — é ela que o cliente " +
      "consegue conferir contra o endereço em que está falando (RFC 8707)",
  );
  assert.deepEqual(
    doc.authorization_servers,
    ["https://os.volund.com.br"],
    "sem o provedor anunciado o cliente tentaria a descoberta na origem do App, " +
      "que não é um servidor de autorização",
  );
  assert.deepEqual(
    doc.bearer_methods_supported,
    ["header"],
    "só cabeçalho: em query string o token acabaria em log de acesso e em " +
      "histórico de navegador",
  );
});

test("sem configuração, o metadado recusa em vez de anunciar meia verdade", async () => {
  const salvo = process.env.VOLUND_OIDC_ISSUER;
  delete process.env.VOLUND_OIDC_ISSUER;
  try {
    const { GET } = await import("../app/api/oauth-protected-resource/route");
    const res = await GET(new Request(`${ORIGEM}${PROTECTED_RESOURCE_METADATA_PATH}`));
    assert.equal(
      res.status,
      503,
      "documento sem `authorization_servers` levaria o cliente a procurar o " +
        "provedor na origem do App; e 503 é retentável, porque a falha é nossa",
    );
  } finally {
    if (salvo !== undefined) process.env.VOLUND_OIDC_ISSUER = salvo;
  }
});

test("a rota EXISTE na tabela de rotas do build, e não só como arquivo", async () => {
  // A mesma prova que a rota de introspecção passou a exigir depois de a v4.0.0
  // publicar um contrato que não roteava: o arquivo no disco não é rota. Aqui o
  // caminho público vem de um `rewrites()`, então o que o manifesto tem de ter é
  // o DESTINO — e o rewrite é conferido à parte, no arquivo de config.
  const fs = await import("node:fs");
  const path = await import("node:path");

  const dir = "app/api/oauth-protected-resource";
  assert.ok(
    fs.existsSync(path.join(dir, "route.ts")),
    `a rota precisa morar em ${dir}`,
  );

  const config = fs.readFileSync("next.config.ts", "utf8");
  assert.ok(
    config.includes(PROTECTED_RESOURCE_METADATA_PATH),
    "sem o rewrite, o handler existe sem endereço público e a descoberta não acha nada",
  );

  const manifesto = ".next/server/app-paths-manifest.json";
  if (!fs.existsSync(manifesto)) {
    assert.fail(
      `sem ${manifesto}: rode \`npm run build\` antes deste teste — ` +
        "é o manifesto que prova que a rota existe, e não o arquivo no disco",
    );
  }
  const rotaMtime = fs.statSync(path.join(dir, "route.ts")).mtimeMs;
  const manifestoMtime = fs.statSync(manifesto).mtimeMs;
  assert.ok(
    manifestoMtime >= rotaMtime,
    "o build é mais antigo que a rota: rode `npm run build` de novo",
  );
  const rotas = Object.keys(JSON.parse(fs.readFileSync(manifesto, "utf8")));
  assert.ok(
    rotas.some((r) => r.startsWith("/api/oauth-protected-resource")),
    `a rota não está no manifesto do build. Presentes: ${rotas.join(", ")}`,
  );
});
