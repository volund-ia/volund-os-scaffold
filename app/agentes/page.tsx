import { AgentChat } from "@/components/volund/agent-chat";
import { Display } from "@/components/ui/display";
import { MonoLabel } from "@/components/ui/mono-label";
import { requireSession } from "@/lib/auth/server";
import { AgentChannelError, listAppAgents, type AppAgent } from "@/lib/volund/agents";

/**
 * A tela de conversa com os agentes deste App — pronta, para o agente que
 * constrói a aplicação usar como está ou como modelo.
 *
 * ## Ela exige sessão, e não está na lista de rotas públicas
 *
 * De propósito. A conversa roda em nome de quem está conversando, e sem sessão
 * não há em nome de quem rodar. Uma versão "para visitante" não seria uma versão
 * mais aberta desta tela: seria outra coisa, rodando no nome de alguém que não
 * pediu.
 *
 * ## O roteiro é carregado aqui, no servidor
 *
 * A tela recebe a lista pronta e não faz uma primeira chamada só para descobrir
 * com quem pode falar — o que apareceria como um instante de tela vazia toda vez
 * que alguém abre a página. Daqui para baixo é tudo cliente, porque conversa é
 * interação.
 *
 * `force-dynamic` porque tudo aqui depende de quem pediu.
 */

export const dynamic = "force-dynamic";

/**
 * Renders the authenticated agents conversation page.
 *
 * @returns The agents page with the available assistants or an unavailable-state message.
 */
export default async function Agentes() {
  const session = await requireSession("/agentes");

  let agents: AppAgent[] = [];
  let indisponivel: string | null = null;

  try {
    agents = await listAppAgents(session);
  } catch (err) {
    if (err instanceof AgentChannelError) {
      indisponivel = err.message;
    } else {
      console.error("[agentes] falha ao carregar o roteiro:", err);
      indisponivel = "Não consegui carregar os assistentes agora. Recarregue a página.";
    }
  }

  return (
    <main className="mx-auto flex h-[100dvh] w-full max-w-[880px] flex-col gap-6 p-6">
      <header className="flex flex-col gap-1.5">
        <MonoLabel>Assistentes</MonoLabel>
        <Display size="page">Converse com quem trabalha aqui</Display>
        <p className="text-muted-foreground text-[13px] leading-[1.65]">
          Eles agem em seu nome, com o que você tem acesso — e o que fizerem fica
          registrado como seu.
        </p>
      </header>

      {indisponivel ? (
        <div className="border-border-subtle bg-surface flex flex-1 items-center justify-center rounded-[16px] border p-8">
          <p className="text-muted-foreground max-w-[46ch] text-center text-[13px] leading-[1.65]">
            {indisponivel}
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          <AgentChat agents={agents} />
        </div>
      )}
    </main>
  );
}
