import type { OrgAppearance } from "@/lib/volund/appearance";

/**
 * O logo e o nome da organização (contrato 9), vindos da plataforma por
 * `loadAppAppearance`. Só apresenta: quem busca é a página ou o layout.
 *
 * Sem marca (plataforma fora, organização sem logo), não desenha nada — o lugar
 * dela não vira um quadrado vazio nem um "Sua empresa" inventado.
 *
 * `<img>`, e não `next/image`: o logo mora no armazenamento da plataforma, num
 * host que muda por ambiente, e `next/image` exigiria declarar esse host em
 * `next.config.ts` — um App publicado que esquecesse quebraria o logo.
 */
export function OrgBrand({
  appearance,
  className,
}: {
  appearance: OrgAppearance | null;
  className?: string;
}) {
  if (!appearance?.logoUrl && !appearance?.name) return null;
  return (
    <div className={`flex items-center gap-2.5 ${className ?? ""}`}>
      {appearance.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- ver o comentário acima
        <img
          src={appearance.logoUrl}
          alt={appearance.name ?? ""}
          className="h-6 w-auto max-w-[160px] object-contain"
        />
      ) : null}
      {appearance.name && !appearance.logoUrl ? (
        <span className="text-[14px] font-medium tracking-[-0.01em]">
          {appearance.name}
        </span>
      ) : null}
    </div>
  );
}
