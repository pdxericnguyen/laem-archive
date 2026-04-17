import type { SiteVisual } from "@/lib/site-visuals";

type Props = {
  visual: SiteVisual | null;
  variant?: "hero" | "banner" | "inline";
  className?: string;
};

function getAspectClass(variant: NonNullable<Props["variant"]>) {
  if (variant === "hero") {
    return "aspect-[4/5] md:aspect-[21/9]";
  }
  if (variant === "banner") {
    return "aspect-[5/3] md:aspect-[4/1]";
  }
  return "aspect-[16/9]";
}

export default function SiteVisualPlacement({ visual, variant = "inline", className = "" }: Props) {
  if (!visual?.published || !visual.imageUrl) {
    return null;
  }

  const hasCopy = Boolean(visual.eyebrow || visual.headline || visual.body || visual.linkLabel);
  const card = (
    <div className={`group relative overflow-hidden border border-neutral-200 bg-neutral-100 ${getAspectClass(variant)} ${className}`}>
      <img
        src={visual.imageUrl}
        alt={visual.altText}
        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.015]"
        loading={variant === "hero" ? "eager" : "lazy"}
      />
      {hasCopy ? (
        <div className="absolute inset-x-3 bottom-3 max-w-xl border border-neutral-200 bg-white/90 p-3 text-neutral-900 backdrop-blur md:inset-x-5 md:bottom-5 md:p-4">
          {visual.eyebrow ? (
            <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-neutral-500">{visual.eyebrow}</p>
          ) : null}
          {visual.headline ? (
            <h2 className="mt-1 text-base font-semibold tracking-tight md:text-lg">{visual.headline}</h2>
          ) : null}
          {visual.body ? <p className="mt-2 text-xs leading-relaxed text-neutral-700 md:text-sm">{visual.body}</p> : null}
          {visual.linkLabel && visual.linkHref ? (
            <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-800">
              {visual.linkLabel}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  if (visual.linkHref) {
    return (
      <a href={visual.linkHref} className="block no-underline">
        {card}
      </a>
    );
  }

  return card;
}
