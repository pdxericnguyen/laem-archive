"use client";

import { KeyboardEvent, PointerEvent, UIEvent, useEffect, useMemo, useRef, useState } from "react";

type Props = {
  title: string;
  images: string[];
};

type GalleryDirection = "previous" | "next";

function normalizeImages(images: string[]) {
  return images.map((item) => item.trim()).filter(Boolean);
}

export default function ProductGallery({ title, images }: Props) {
  const gallery = useMemo(() => normalizeImages(images), [images]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [transitionDirection, setTransitionDirection] = useState<GalleryDirection>("next");
  const thumbnailStripRef = useRef<HTMLDivElement | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const wheelLockRef = useRef(false);
  const wheelUnlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => {
    return () => {
      if (wheelUnlockTimerRef.current) {
        clearTimeout(wheelUnlockTimerRef.current);
      }
    };
  }, []);

  function isFromGalleryControl(event: PointerEvent<HTMLDivElement>) {
    return event.target instanceof Element && Boolean(event.target.closest("[data-gallery-control]"));
  }

  function holdWheelUntilGestureEnds() {
    if (wheelUnlockTimerRef.current) {
      clearTimeout(wheelUnlockTimerRef.current);
    }

    wheelUnlockTimerRef.current = setTimeout(() => {
      wheelLockRef.current = false;
      wheelUnlockTimerRef.current = null;
    }, 420);
  }

  function move(direction: GalleryDirection) {
    if (gallery.length <= 1) {
      return;
    }

    setTransitionDirection(direction);
    setActiveIndex((value) => {
      const currentIndex = Math.min(gallery.length - 1, Math.max(0, value));
      const step = direction === "next" ? 1 : -1;
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
    move("previous");
  }

  function next() {
    move("next");
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (gallery.length <= 1 || isFromGalleryControl(event)) {
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

    event.preventDefault();
    holdWheelUntilGestureEnds();
    if (wheelLockRef.current) {
      return;
    }

    wheelLockRef.current = true;
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
            key={`${activeImage}-${transitionDirection}`}
            src={activeImage}
            alt={`${title} image ${safeIndex + 1}`}
            className={`h-full w-full object-cover select-none gallery-image-${transitionDirection}`}
            loading="lazy"
            draggable={false}
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
              data-gallery-control
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
              data-gallery-control
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
        .gallery-image-next {
          animation: gallery-slide-next 220ms ease-out;
        }

        .gallery-image-previous {
          animation: gallery-slide-previous 220ms ease-out;
        }

        @keyframes gallery-slide-next {
          from {
            opacity: 0.72;
            transform: translateX(14px);
          }

          to {
            opacity: 1;
            transform: translateX(0);
          }
        }

        @keyframes gallery-slide-previous {
          from {
            opacity: 0.72;
            transform: translateX(-14px);
          }

          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
      `}</style>
    </div>
  );
}
