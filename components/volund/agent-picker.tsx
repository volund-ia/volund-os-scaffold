"use client";

import type { AppAgent } from "@/lib/volund/agents";
import { cn } from "@/lib/utils";

/**
 * A escolha de com QUAL agente conversar.
 *
 * ## Ele some quando há um agente só
 *
 * E é o ponto do componente. O App suporta vários agentes desde o primeiro dia,
 * mas a maioria vai ter um — e um seletor com uma opção é um controle que pede
 * uma decisão que não existe. Quem tem um agente não vê nada; quem vincula o
 * segundo ganha a escolha sem ninguém mexer em código.
 *
 * ## Iniciais, e não a imagem do agente
 *
 * O `avatar` do roteiro é um **slug** (`"assistant"`), e não um endereço de
 * imagem: quem sabe desenhá-lo é o painel do VolundOS, que tem o conjunto de
 * ilustrações. Aqui ele não resolve para nada, e tratá-lo como URL renderizaria
 * uma imagem quebrada — o campo continua sendo entregue no tipo porque faz parte
 * do contrato, não porque esta tela saiba usá-lo.
 *
 * As iniciais funcionam em qualquer implantação, não dependem de a rede
 * responder e não pedem nenhuma decisão sobre de onde a aplicação aceita
 * carregar imagem.
 */
export function AgentPicker({
  agents,
  selecionado,
  onSelecionar,
  disabled,
}: {
  agents: AppAgent[];
  selecionado: string;
  onSelecionar: (key: string) => void;
  disabled?: boolean;
}) {
  if (agents.length <= 1) return null;

  return (
    <div
      role="radiogroup"
      aria-label="Escolha o assistente"
      className="flex flex-wrap gap-2"
    >
      {agents.map((agent) => {
        const ativo = agent.key === selecionado;
        return (
          <button
            key={agent.key}
            type="button"
            role="radio"
            aria-checked={ativo}
            disabled={disabled}
            onClick={() => onSelecionar(agent.key)}
            className={cn(
              "border-border-subtle bg-surface flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] transition-colors",
              "focus-visible:ring-ring/50 outline-none focus-visible:ring-3",
              "disabled:pointer-events-none disabled:opacity-50",
              ativo
                ? "border-primary/40 bg-primary/10 text-foreground"
                : "text-muted-foreground hover:border-border-strong hover:text-foreground",
            )}
          >
            <span
              aria-hidden
              className="bg-surface-elevated text-muted-foreground flex size-5 items-center justify-center rounded-full font-mono text-[10px]"
            >
              {iniciais(agent.name)}
            </span>
            {agent.name}
          </button>
        );
      })}
    </div>
  );
}

/** Até duas iniciais. Um nome de uma palavra rende uma; vazio rende o traço. */
function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "—";
  const letras = partes.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "");
  return letras.join("");
}
