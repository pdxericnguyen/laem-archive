"use client";

import { KeyboardEvent, PointerEvent, UIEvent, useEffect, useMemo, useRef, useState } from "react";

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
  const thumbnailStripRef = useRef<HTMLDivElement | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const wheelGateRef = useRef(0);

  const hasImages = gallery.length > 0;
  const safeIndex = hasImages ? Math.min(activeIndex, gallery.length - 1) : 0;
  const activeImage = hasImages ? gallery[safeIndex] : "";

  useEffect(() => {
    if (!thumbnailStripRef.current) {
      return;
    }

    const activeThumbnail = thumbnailStripRef.current.querySelector<HTMLButtonElement>(
      `[data-gallery-thumb="${safeIndex}"]`
    );
    activeThumbnail?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center"
    });
  }, [safeIndex]);

  function move(step: -1 | 1) {
    if (gallery.length <= 1) {
      return;
    }

    setActiveIndex((value) => {
      const currentIndex = Math.min(gallery.length - 1, Math.max(0, value));
      const nextIndex = currentIndex + step;
      if (nextIndex < 0) {
        return gallery.length - 1;
      }
      if (nextIndex >= gallery.length) {
        return 0;
      }
      return nextIndex;
    });
  }

  function prev() {
    move(-1);
  }

  function next() {
    move(1);
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (gallery.length <= 1) {
      return;
    }

    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointerStartRef.current = {
      x: event.clientX,
      y: event.clientY
    };
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    const start = pointerStartRef.current;
    pointerStartRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (!start || gallery.length <= 1) {
      return;
    }

    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (Math.abs(deltaX) < 40 || Math.abs(deltaX) <= Math.abs(deltaY)) {
      return;
    }

    if (deltaX < 0) {
      next();
      return;
    }

    prev();
  }

  function handlePointerCancel(event: PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    pointerStartRef.current = null;
  }

  function handleWheel(event: UIEvent<HTMLDivElement> & { deltaX: number; deltaY: number; shiftKey: boolean }) {
    if (gallery.length <= 1) {
      return;
    }

    const primaryDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.shiftKey ? event.deltaY : 0;
    if (Math.abs(primaryDelta) < 8) {
      return;
    }

    const now = Date.now();
    if (now - wheelGateRef.current < 250) {
      return;
    }

    wheelGateRef.current = now;
    event.preventDefault();
    if (primaryDelta > 0) {
      next();
      return;
    }

    prev();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (gallery.length <= 1) {
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      prev();
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      next();
    }
  }

  return (
    <div className="space-y-3">
      <div
        className="relative aspect-[4/5] w-full overflow-hidden bg-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-400 cursor-grab active:cursor-grabbing"
        tabIndex={gallery.length > 1 ? 0 : -1}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onWheel={handleWheel}
        style={{ touchAction: "pan-y" }}
        aria-label={gallery.length > 1 ? `${title} gallery. Use arrow keys or swipe to change images.` : `${title} gallery`}
      >
        {activeImage ? (
          <img
            key={activeImage}
            src={activeImage}
            alt={`${title} image ${safeIndex + 1}`}
            className="h-full w-full object-cover select-none"
            loading="lazy"
            draggable={false}
            style={{ animation: "gallery-fade 220ms ease-out" }}
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
              onClick={() => prev()}
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
              onClick={() => next()}
              className="pointer-events-auto h-9 w-9 border border-neutral-300 bg-white/90 text-sm font-semibold hover:bg-white"
              aria-label="Next image"
            >
              {">"}
            </button>
          </div>
        ) : null}
      </div>

      {gallery.length > 1 ? (
        <div ref={thumbnailStripRef} className="flex gap-2 overflow-x-auto pb-1 scroll-smooth">
          {gallery.map((imageUrl, index) => (
            <button
              key={`${imageUrl}-${index}`}
              type="button"
              data-gallery-thumb={index}
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

      <style jsx>{`
        @keyframes gallery-fade {
          from {
            opacity: 0.72;
          }

          to {
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}
