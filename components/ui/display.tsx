import { cn } from "@/lib/utils";

/**
 * Título, com o `tracking` já correto para o tamanho.
 *
 * O DESIGN.md pede tracking NEGATIVO nos títulos, e quanto maior o texto, mais
 * fechado. É a regra que ninguém acerta de memória e que, errada, faz o título
 * parecer de outro produto — daí ela morar aqui em vez de numa tabela para
 * consultar.
 *
 * - `page`: o título de uma tela.
 * - `section`: o título de um bloco dentro dela.
 * - `card`: o título de um cartão.
 */
export function Display({
  size = "section",
  as,
  children,
  className,
}: {
  size?: "page" | "section" | "card";
  /** O nível do heading. O tamanho é visual; a hierarquia do documento é sua. */
  as?: "h1" | "h2" | "h3";
  children: React.ReactNode;
  className?: string;
}) {
  const Tag = as ?? (size === "page" ? "h1" : size === "section" ? "h2" : "h3");
  const styles = {
    page: "text-[32px] leading-[1.1] tracking-[-0.025em] font-semibold",
    section: "text-[22px] leading-[1.2] tracking-[-0.015em] font-medium",
    card: "text-[15px] leading-[1.4] tracking-[-0.01em] font-medium",
  }[size];

  return <Tag className={cn(styles, "text-foreground", className)}>{children}</Tag>;
}
