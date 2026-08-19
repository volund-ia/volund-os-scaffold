import { cn } from "@/lib/utils";

/**
 * Rótulo de seção em mono — o "eyebrow" do DESIGN.md.
 *
 * Existe como componente para o par caixa-alta + `tracking` largo + DM Mono não
 * ser reescrito de três jeitos diferentes em três telas. Use acima de um grupo de
 * conteúdo ("Publicados", "Configurações"), nunca como decoração solta: ele
 * anuncia que o que vem abaixo é um conjunto.
 */
export function MonoLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "text-muted-foreground font-mono text-[11px] tracking-[0.14em] uppercase",
        className,
      )}
    >
      {children}
    </span>
  );
}
