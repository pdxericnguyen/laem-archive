"use client";

import { useMemo, useState } from "react";

type Props = {
  title: string;
  images: string[];
};

function normalizeImages(images: string[]) {
  return images.map((item) => item.trim()).filter(Boolean);
}

export default function ProductGallery({ title, images }: Props) {
  const gallery = useMemo(() => normalizeImages(images), [images]);
  const [activeIndex, setActiveIndex] = useState(0);

  const hasImages = gallery.length > 0;
  const safeIndex = hasImages ? Math.min(activeIndex, gallery.length - 1) : 0;
  const activeImage = hasImages ? gallery[safeIndex] : "";

  function prev() {
    if (!hasImages) {
      return;
    }
    setActiveIndex((value) => (value <= 0 ? gallery.length - 1 : value - 1));
  }

  function next() {
    if (!hasImages) {
      return;
    }
    setActiveIndex((value) => (value >= gallery.length - 1 ? 0 : value + 1));
  }

  return (
    <div className="space-y-3">
      <div className="relative aspect-[4/5] w-full overflow-hidden bg-neutral-100">
        {activeImage ? (
          <img
            src={activeImage}
            alt={`${title} image ${safeIndex + 1}`}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs uppercase tracking-[0.12em] text-neutral-500">
            No image
          </div>
        )}

        {gallery.length > 1 ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between p-2">
            <button
              type="button"
              onClick={prev}
              className="pointer-events-auto h-9 w-9 border border-neutral-300 bg-white/90 text-sm font-semibold hover:bg-white"
              aria-label="Previous image"
            >
              {"<"}
            </button>
            <div className="rounded border border-neutral-300 bg-white/90 px-2 py-1 text-[11px] uppercase tracking-[0.12em] text-neutral-700">
              {safeIndex + 1} / {gallery.length}
            </div>
            <button
              type="button"
              onClick={next}
              className="pointer-events-auto h-9 w-9 border border-neutral-300 bg-white/90 text-sm font-semibold hover:bg-white"
              aria-label="Next image"
            >
              {">"}
            </button>
          </div>
        ) : null}
      </div>

      {gallery.length > 1 ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {gallery.map((imageUrl, index) => (
            <button
              key={`${imageUrl}-${index}`}
              type="button"
              className={`relative h-20 w-16 shrink-0 overflow-hidden border ${
                index === safeIndex ? "border-neutral-700" : "border-neutral-300"
              }`}
              onClick={() => setActiveIndex(index)}
              aria-label={`Show image ${index + 1}`}
            >
              <img
                src={imageUrl}
                alt={`${title} thumbnail ${index + 1}`}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
