import { guard } from "@/lib/auth/server";
import { embedSessionPost } from "@/lib/volund/embed-session-http";

/**
 * Uma sessão NOVA do chat embutido, para a tela que já está aberta.
 *
 *   POST /api/volund/embed-session
 *   { agent?, threadId?, colorMode?, replaces? }
 *   →  201 { embedUrl, sessionId, expiresAt, threadId }
 *
 * ## Quando a tela chama
 *
 * A página `/agentes` cria a primeira sessão no servidor e já nasce com o
 * endereço do quadro. Esta rota existe para o que acontece DEPOIS: o quadro
 * avisa `volund:session-expiring` dois minutos antes do fim, e o
 * `AgentEmbed` pede aqui um endereço novo — com o `threadId` da conversa em
 * curso, para a pessoa continuar onde estava. E para o "Abrir de novo" depois
 * de um `volund:error`.
 *
 * O endereço tem código de uso único que vence em 120 segundos, então ele não
 * pode ser pedido antes nem guardado: a tela pede, usa e esquece.
 *
 * `replaces` encerra a sessão anterior depois de a nova existir — limpeza, e
 * não condição: se falhar, a antiga vence sozinha no fim do prazo.
 *
 * O corpo exige `content-type: application/json`. Sem isso, um formulário de
 * outro site (que o navegador manda sem pré-verificação) chegaria aqui com o
 * cookie de quem o abriu.
 *
 * O miolo está em `lib/volund/embed-session-http.ts`, onde o teste o alcança.
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const gate = await guard();
  if (!gate.ok) return gate.response;
  return embedSessionPost(request, gate.session);
}
