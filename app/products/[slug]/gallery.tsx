"use client";

import { KeyboardEvent, PointerEvent, WheelEvent, useEffect, useMemo, useRef, useState } from "react";

type Props = {
  title: string;
  images: string[];
};

type GalleryDirection = "previous" | "next";

const WHEEL_GESTURE_IDLE_MS = 140;
const WHEEL_GESTURE_THRESHOLD = 28;
const WHEEL_LINE_DELTA_PX = 18;
const WHEEL_PAGE_DELTA_PX = 120;
const WRAP_CUE_MS = 240;
const WHEEL_MOVE_COOLDOWN_MS = 170;

function normalizeImages(images: string[]) {
  return images.map((item) => item.trim()).filter(Boolean);
}

export default function ProductGallery({ title, images }: Props) {
  const gallery = useMemo(() => normalizeImages(images), [images]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [transitionDirection, setTransitionDirection] = useState<GalleryDirection>("next");
  const [wrapCueDirection, setWrapCueDirection] = useState<GalleryDirection | null>(null);
  const thumbnailStripRef = useRef<HTMLDivElement | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const wheelGestureRef = useRef<{ delta: number; direction: GalleryDirection | null; lastMoveAt: number }>({
    delta: 0,
    direction: null,
    lastMoveAt: 0
  });
  const wheelResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapCueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      if (wheelResetTimerRef.current) {
        clearTimeout(wheelResetTimerRef.current);
      }
      if (wrapCueTimerRef.current) {
        clearTimeout(wrapCueTimerRef.current);
      }
    };
  }, []);

  function isFromGalleryControl(event: PointerEvent<HTMLDivElement>) {
    return event.target instanceof Element && Boolean(event.target.closest("[data-gallery-control]"));
  }

  function resetWheelGestureSoon() {
    if (wheelResetTimerRef.current) {
      clearTimeout(wheelResetTimerRef.current);
    }

    wheelResetTimerRef.current = setTimeout(() => {
      wheelGestureRef.current = {
        delta: 0,
        direction: null,
        lastMoveAt: 0
      };
      wheelResetTimerRef.current = null;
    }, WHEEL_GESTURE_IDLE_MS);
  }

  function triggerWrapCue(direction: GalleryDirection) {
    if (wrapCueTimerRef.current) {
      clearTimeout(wrapCueTimerRef.current);
    }

    setWrapCueDirection(direction);
    wrapCueTimerRef.current = setTimeout(() => {
      setWrapCueDirection(null);
      wrapCueTimerRef.current = null;
    }, WRAP_CUE_MS);
  }

  function move(direction: GalleryDirection) {
    if (gallery.length <= 1) {
      return;
    }

    let wrapped = false;
    setTransitionDirection(direction);
    setActiveIndex((value) => {
      const currentIndex = Math.min(gallery.length - 1, Math.max(0, value));
      const step = direction === "next" ? 1 : -1;
      const nextIndex = currentIndex + step;
      if (nextIndex < 0) {
        wrapped = true;
        return gallery.length - 1;
      }
      if (nextIndex >= gallery.length) {
        wrapped = true;
        return 0;
      }
      return nextIndex;
    });

    if (wrapped) {
      triggerWrapCue(direction);
    }
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

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    if (gallery.length <= 1) {
      return;
    }

    const rawDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.shiftKey ? event.deltaY : 0;
    const deltaScale =
      event.deltaMode === 1 ? WHEEL_LINE_DELTA_PX : event.deltaMode === 2 ? WHEEL_PAGE_DELTA_PX : 1;
    const primaryDelta = rawDelta * deltaScale;
    if (Math.abs(primaryDelta) < 4) {
      return;
    }

    event.preventDefault();
    resetWheelGestureSoon();

    const direction: GalleryDirection = primaryDelta > 0 ? "next" : "previous";
    const gesture = wheelGestureRef.current;
    if (gesture.direction && gesture.direction !== direction) {
      gesture.delta = 0;
    }

    gesture.direction = direction;
    gesture.delta += primaryDelta;
    const now = Date.now();

    if (Math.abs(gesture.delta) < WHEEL_GESTURE_THRESHOLD) {
      return;
    }

    if (now - gesture.lastMoveAt < WHEEL_MOVE_COOLDOWN_MS) {
      return;
    }

    gesture.lastMoveAt = now;
    gesture.delta = 0;
    if (direction === "next") {
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
        className={`relative aspect-[4/5] w-full overflow-hidden bg-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-400 cursor-grab active:cursor-grabbing ${
          wrapCueDirection ? `gallery-wrap-cue-${wrapCueDirection}` : ""
        }`}
        tabIndex={gallery.length > 1 ? 0 : -1}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onWheel={handleWheel}
        style={{ overscrollBehaviorX: "contain", touchAction: "pan-y" }}
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
        .gallery-wrap-cue-next::after,
        .gallery-wrap-cue-previous::after {
          content: "";
          pointer-events: none;
          position: absolute;
          inset: 0;
          opacity: 0;
        }

        .gallery-wrap-cue-next::after {
          background: linear-gradient(90deg, rgba(255, 255, 255, 0), rgba(255, 255, 255, 0.35));
          animation: gallery-wrap-cue-next ${WRAP_CUE_MS}ms ease-out;
        }

        .gallery-wrap-cue-previous::after {
          background: linear-gradient(270deg, rgba(255, 255, 255, 0), rgba(255, 255, 255, 0.35));
          animation: gallery-wrap-cue-previous ${WRAP_CUE_MS}ms ease-out;
        }

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

        @keyframes gallery-wrap-cue-next {
          from {
            opacity: 0.85;
          }

          to {
            opacity: 0;
          }
        }

        @keyframes gallery-wrap-cue-previous {
          from {
            opacity: 0.85;
          }

          to {
            opacity: 0;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .gallery-image-next,
          .gallery-image-previous {
            animation: gallery-fade-reduced 120ms linear;
          }

          .gallery-wrap-cue-next::after,
          .gallery-wrap-cue-previous::after {
            animation: none;
            opacity: 0;
          }
        }

        @keyframes gallery-fade-reduced {
          from {
            opacity: 0.85;
          }

          to {
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}
