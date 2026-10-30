import Link from "next/link";

import { Display } from "@/components/ui/display";
import { MonoLabel } from "@/components/ui/mono-label";
import { AgentEmbed, type AgentEmbedSession } from "@/components/volund/agent-embed";
import { OrgBrand } from "@/components/volund/org-brand";
import { readAuthConfig } from "@/lib/auth/config";
import { requireSession } from "@/lib/auth/server";
import {
  AgentChannelError,
  listAppAgents,
  selectAgent,
  type AppAgent,
} from "@/lib/volund/agents";
import { orgAppearance } from "@/lib/volund/appearance";
import { createEmbedSession } from "@/lib/volund/embed";

/**
 * A conversa com os agentes deste App — o chat embutido do VolundOS (contrato 9).
 *
 * ## O que esta página faz, e o que não
 *
 * Ela não desenha conversa nenhuma. No servidor, ela lê o roteiro (quais
 * agentes o App oferece), escolhe o agente pelo `?agente=<apelido>` (sem ele, o
 * padrão), cria a sessão do chat em nome de quem está aqui e entrega ao
 * `AgentEmbed` o endereço do quadro. Daí em diante a conversa é do VolundOS.
 *
 * ## Por que a sessão nasce a cada abertura
 *
 * O endereço do quadro leva um código de uso único que vence em 120 segundos.
 * Guardá-lo serviria um código gasto a quem voltasse à página. `force-dynamic`
 * por isso, e porque tudo aqui depende de quem pediu.
 *
 * ## Ela exige sessão
 *
 * A conversa roda em nome de quem está conversando, e sem sessão não há em nome
 * de quem rodar.
 *
 * ## Falhar não quebra a página
 *
 * Sem agente vinculado, plataforma fora, apelido que o App não oferece: a página
 * abre e diz o que aconteceu, numa frase que a pessoa entende.
 */

export const dynamic = "force-dynamic";

const GENERICO = "Não consegui abrir a conversa agora. Recarregue a página.";

function mensagemDe(err: unknown): string {
  if (err instanceof AgentChannelError) return err.message;
  console.error("[agentes] falha ao abrir a conversa:", err);
  return GENERICO;
}

export default async function Agentes({
  searchParams,
}: {
  searchParams: Promise<{ agente?: string | string[] }>;
}) {
  const session = await requireSession("/agentes");
  const pedido = (await searchParams).agente;
  const apelido = typeof pedido === "string" && pedido ? pedido : null;

  let agents: AppAgent[] = [];
  let atual: AppAgent | null = null;
  let embed: AgentEmbedSession | null = null;
  let origem: string | null = null;
  let indisponivel: string | null = null;

  try {
    origem = new URL(readAuthConfig().issuer).origin;
    agents = await listAppAgents(session);
    atual = selectAgent(agents, apelido);
    if (!atual) {
      indisponivel = `Este app não oferece um assistente chamado "${apelido}". Escolha um da lista.`;
    } else {
      const criada = await createEmbedSession(session, { agent: atual.key });
      embed = {
        sessionId: criada.sessionId,
        embedUrl: criada.embedUrl,
        threadId: criada.threadId,
      };
    }
  } catch (err) {
    indisponivel = mensagemDe(err);
  }

  const appearance = await orgAppearance();

  return (
    <main className="mx-auto flex h-[100dvh] w-full max-w-[960px] flex-col gap-5 p-6">
      <header className="flex flex-col gap-1.5">
        <OrgBrand appearance={appearance} className="mb-1" />
        <MonoLabel>Assistentes</MonoLabel>
        <Display size="page">
          {atual ? atual.name : "Converse com quem trabalha aqui"}
        </Display>
        <p className="text-muted-foreground text-[13px] leading-[1.65]">
          {atual?.description ??
            "Eles agem em seu nome, com o que você tem acesso — e o que fizerem fica registrado como seu."}
        </p>
      </header>

      {/* Um link por agente, e não um seletor de cliente: trocar de agente é
          abrir OUTRA sessão, e quem a cria é o servidor. */}
      {agents.length > 1 ? (
        <nav aria-label="Assistentes" className="flex flex-wrap gap-2">
          {agents.map((a) => {
            const ativo = a.key === atual?.key;
            return (
              <Link
                key={a.key}
                href={`/agentes?agente=${encodeURIComponent(a.key)}`}
                aria-current={ativo ? "page" : undefined}
                className={
                  ativo
                    ? "border-border-strong bg-surface-interactive-hover rounded-[10px] border px-3 py-1.5 text-[13px] font-medium"
                    : "border-border-subtle bg-surface hover:border-border-strong text-muted-foreground hover:text-foreground rounded-[10px] border px-3 py-1.5 text-[13px] transition-colors"
                }
              >
                {a.name}
              </Link>
            );
          })}
        </nav>
      ) : null}

      {embed && origem ? (
        <div className="min-h-0 flex-1">
          {/* A chave é a sessão: trocar de agente pelo link acima renderiza a
              página de novo com OUTRA sessão, e o componente guarda a sua em
              estado — sem a chave ele ficaria com a do agente anterior. */}
          <AgentEmbed
            key={embed.sessionId}
            session={embed}
            platformOrigin={origem}
            agent={atual?.key}
          />
        </div>
      ) : (
        <div className="border-border-subtle bg-surface flex flex-1 items-center justify-center rounded-[16px] border p-8">
          <p className="text-muted-foreground max-w-[46ch] text-center text-[13px] leading-[1.65]">
            {indisponivel ?? GENERICO}
          </p>
        </div>
      )}
    </main>
  );
}
