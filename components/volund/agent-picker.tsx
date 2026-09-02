"use client";

import type { AppAgent } from "@/lib/volund/agents";
import { cn } from "@/lib/utils";

/**
 * Renders an accessible agent selector when multiple agents are available.
 *
 * The selector displays each agent's initials and name, marks the selected
 * agent, and hides itself when zero or one agent is available.
 *
 * @param selecionado - The key of the currently selected agent.
 * @returns The agent selector, or `null` when there is at most one agent.
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

/**
 * Formats a name as up to two uppercase initials.
 *
 * @param nome - The name from which to derive initials
 * @returns The initials, or `—` when the name is empty
 */
function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "—";
  const letras = partes.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "");
  return letras.join("");
}
