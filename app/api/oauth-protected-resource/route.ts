import { MCP_PATH, readAuthConfig } from "@/lib/auth/config";

/**
 * GET /.well-known/oauth-protected-resource  (reescrito para cá — ver `next.config.ts`)
 *
 * Este App se descrevendo como recurso protegido (RFC 9728) — o documento que
 * abre o fluxo padrão de autorização do MCP.
 *
 * ## O que ele resolve
 *
 * Um cliente de MCP que nunca ouviu falar do VolundOS bate no endpoint, toma 401,
 * lê o `resource_metadata` do `WWW-Authenticate` e cai aqui. É por este documento
 * que ele descobre para onde ir pedir autorização. Sem ele, o cliente sabe apenas
 * que falhou — e a mensagem que mostra fala do App, não da descoberta.
 *
 * ## Por que o `resource` é a URL, e não o `volund:app:<id>`
 *
 * A spec do MCP pede o identificador canônico do servidor MCP, e é a URL dele que
 * o cliente consegue conferir contra o endereço em que está falando (RFC 8707).
 * O `volund:app:<id>` continua sendo a audiência interna do token — o provedor a
 * deriva do cliente registrado, não deste documento. Anunciar a forma interna
 * aqui pediria ao cliente que soubesse de uma convenção nossa para completar um
 * fluxo padrão.
 *
 * ## Por que é público
 *
 * Porque ele é lido ANTES de existir qualquer token — é a definição de metadado de
 * descoberta. Está enumerado em `lib/auth/route-policy.ts`; sem isso o portão de
 * cookie responde 401 e a descoberta morre no primeiro passo, com o documento
 * pronto do outro lado.
 *
 * ## Por que o handler mora em `app/api/**`
 *
 * Pasta iniciada por ponto dependeria de o scanner de rotas do Next não a ignorar
 * — a mesma aposta que já custou uma release quando `_volund` virou pasta privada.
 * O `rewrites()` fixa o caminho público de forma determinística.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const origem = new URL(request.url).origin;

  let issuer: string;
  try {
    issuer = readAuthConfig().issuer;
  } catch (err) {
    // Sem a configuração não há servidor de autorização para anunciar, e um
    // documento sem `authorization_servers` levaria o cliente a tentar o
    // caminho de descoberta na própria origem do App — que não é um provedor.
    // 503 e não 500: é retentável, e a causa é nossa.
    console.error("[auth] metadado de recurso protegido sem configuração:", err);
    return Response.json({ error: "autenticação não configurada" }, { status: 503 });
  }

  return Response.json(
    {
      resource: `${origem}${MCP_PATH}`,
      authorization_servers: [issuer],
      scopes_supported: ["openid", "profile", "email", "volund.permissions"],
      // Só cabeçalho. O token deste App autoriza ações — em query string ele
      // acabaria em log de acesso e em histórico de navegador.
      bearer_methods_supported: ["header"],
      resource_documentation: `${origem}/`,
    },
    {
      headers: {
        // Documento estável, e é o primeiro passo de todo handshake: sem cache,
        // cada tentativa de conexão de cada cliente vira uma execução nossa.
        "cache-control": "public, max-age=300, stale-while-revalidate=600",
      },
    },
  );
}
