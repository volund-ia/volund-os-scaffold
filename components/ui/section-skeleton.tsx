import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * O lugar de um cartão enquanto ele carrega.
 *
 * ## Por que isto existe, se já há `Skeleton`
 *
 * Porque o `Skeleton` é um retângulo, e o que falta na hora de escrever a tela é
 * a decisão de **ocupar a mesma caixa** que o conteúdo vai ocupar. Sem ela, o
 * caminho de menor esforço é devolver `null` enquanto carrega — e aí o conteúdo
 * brota quando a resposta chega, empurrando o que estava abaixo. Numa página
 * inteira, o `null` é uma tela branca, e branco lê-se como defeito.
 *
 * Medido no próprio VolundOS: uma aba com quatro requisições paralelas e `null`
 * em cada seção abria com dois cartões e ganhava mais quatro conforme as
 * respostas voltavam, sob o cursor de quem já estava lendo.
 *
 * ```tsx
 * if (carregando) return <SectionSkeleton lines={3} />;
 * ```
 */
export function SectionSkeleton({
  lines = 2,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "border-border-subtle bg-surface rounded-[16px] border p-6",
        className,
      )}
      aria-busy
      aria-label="Carregando"
    >
      <Skeleton className="h-[15px] w-40" />
      <div className="mt-4 space-y-2">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton
            key={i}
            className="h-[13px]"
            style={{ width: i === lines - 1 ? "60%" : "100%" }}
          />
        ))}
      </div>
    </div>
  );
}
