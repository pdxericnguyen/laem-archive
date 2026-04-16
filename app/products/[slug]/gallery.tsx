"use client";

import { type KeyboardEvent, type UIEvent, type WheelEvent, useEffect, useMemo, useRef, useState } from "react";

type Props = {
  title: string;
  images: string[];
};

type GalleryDirection = "previous" | "next";

const WRAP_CUE_MS = 240;
const WHEEL_GESTURE_LULL_MS = 320;
const WHEEL_WRAP_BLOCK_MS = 360;
const PROGRAMMATIC_SCROLL_MS = 420;

function normalizeImages(images: string[]) {
  return images.map((item) => item.trim()).filter(Boolean);
}

export default function ProductGallery({ title, images }: Props) {
  const gallery = useMemo(() => normalizeImages(images), [images]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [transitionDirection, setTransitionDirection] = useState<GalleryDirection>("next");
  const [wrapCueDirection, setWrapCueDirection] = useState<GalleryDirection | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const thumbnailStripRef = useRef<HTMLDivElement | null>(null);
  const activeIndexRef = useRef(0);
  const wrapCueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wheelGestureRef = useRef<{ direction: GalleryDirection; lastAt: number; startIndex: number } | null>(null);
  const wheelWrapBlockRef = useRef<{ direction: GalleryDirection; until: number } | null>(null);
  const programmaticScrollTargetRef = useRef<number | null>(null);
  const programmaticScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasImages = gallery.length > 0;

  useEffect(() => {
    if (!thumbnailStripRef.current) {
      return;
    }

    const activeThumbnail = thumbnailStripRef.current.querySelector<HTMLButtonElement>(
      `[data-gallery-thumb="${activeIndex}"]`
    );
    activeThumbnail?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center"
    });
  }, [activeIndex]);

  useEffect(() => {
    return () => {
      if (wrapCueTimerRef.current) {
        clearTimeout(wrapCueTimerRef.current);
      }
      if (programmaticScrollTimerRef.current) {
        clearTimeout(programmaticScrollTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (gallery.length <= 0) {
      activeIndexRef.current = 0;
      setActiveIndex(0);
      return;
    }

    if (activeIndexRef.current >= gallery.length) {
      activeIndexRef.current = gallery.length - 1;
      setActiveIndex(gallery.length - 1);
    }
  }, [gallery.length]);

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

  function clearProgrammaticScroll() {
    if (programmaticScrollTimerRef.current) {
      clearTimeout(programmaticScrollTimerRef.current);
      programmaticScrollTimerRef.current = null;
    }
    programmaticScrollTargetRef.current = null;
  }

  function setSelectedIndex(nextIndex: number, direction: GalleryDirection, wrapped = false) {
    if (gallery.length <= 0) {
      return;
    }

    const previousIndex = activeIndexRef.current;
    setTransitionDirection(direction);
    activeIndexRef.current = nextIndex;
    setActiveIndex(nextIndex);

    const viewport = viewportRef.current;
    if (viewport) {
      clearProgrammaticScroll();
      programmaticScrollTargetRef.current = nextIndex;
      const shouldAnimate = !wrapped && Math.abs(nextIndex - previousIndex) === 1;

      viewport.scrollTo({
        left: nextIndex * viewport.clientWidth,
        behavior: shouldAnimate ? "smooth" : "auto"
      });

      programmaticScrollTimerRef.current = setTimeout(
        clearProgrammaticScroll,
        shouldAnimate ? PROGRAMMATIC_SCROLL_MS : 40
      );
    }

    if (wrapped) {
      triggerWrapCue(direction);
    }
  }

  function move(direction: GalleryDirection) {
    if (gallery.length <= 1) {
      return;
    }

    const current = activeIndexRef.current;
    const nextIndex = direction === "next" ? current + 1 : current - 1;
    if (nextIndex < 0) {
      setSelectedIndex(gallery.length - 1, direction, true);
      return;
    }
    if (nextIndex >= gallery.length) {
      setSelectedIndex(0, direction, true);
      return;
    }

    setSelectedIndex(nextIndex, direction);
  }

  function prev() {
    move("previous");
  }

  function next() {
    move("next");
  }

  function scrollTo(index: number) {
    if (index === activeIndex) {
      return;
    }

    setSelectedIndex(index, index > activeIndex ? "next" : "previous");
  }

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    const viewport = event.currentTarget;
    if (gallery.length <= 1 || viewport.clientWidth <= 0) {
      return;
    }

    const programmaticTarget = programmaticScrollTargetRef.current;
    if (programmaticTarget !== null) {
      const targetLeft = programmaticTarget * viewport.clientWidth;
      if (Math.abs(viewport.scrollLeft - targetLeft) < 2) {
        clearProgrammaticScroll();
      }
      return;
    }

    const nextIndex = Math.max(
      0,
      Math.min(gallery.length - 1, Math.round(viewport.scrollLeft / viewport.clientWidth))
    );
    const previousIndex = activeIndexRef.current;
    if (nextIndex === previousIndex) {
      return;
    }

    setTransitionDirection(nextIndex > previousIndex ? "next" : "previous");
    activeIndexRef.current = nextIndex;
    setActiveIndex(nextIndex);
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    if (gallery.length <= 1) {
      return;
    }

    const horizontalDelta = event.deltaX;
    if (horizontalDelta === 0) {
      return;
    }

    const now = window.performance.now();
    const wheelDirection: GalleryDirection = horizontalDelta > 0 ? "next" : "previous";
    const currentGesture = wheelGestureRef.current;
    const isNewGesture =
      !currentGesture ||
      currentGesture.direction !== wheelDirection ||
      now - currentGesture.lastAt > WHEEL_GESTURE_LULL_MS;

    if (isNewGesture) {
      wheelGestureRef.current = {
        direction: wheelDirection,
        lastAt: now,
        startIndex: activeIndexRef.current
      };
    } else {
      currentGesture.lastAt = now;
    }

    const blockedWrap = wheelWrapBlockRef.current;
    if (blockedWrap) {
      if (now >= blockedWrap.until) {
        wheelWrapBlockRef.current = null;
      } else {
        const isSameDirection =
          blockedWrap.direction === "next" ? horizontalDelta > 0 : horizontalDelta < 0;
        if (isSameDirection) {
          event.preventDefault();
          return;
        }
        wheelWrapBlockRef.current = null;
      }
    }

    const current = activeIndexRef.current;
    const gestureStartIndex = wheelGestureRef.current?.startIndex ?? current;

    if (current === gallery.length - 1 && wheelDirection === "next" && gestureStartIndex === gallery.length - 1) {
      event.preventDefault();
      wheelWrapBlockRef.current = { direction: "next", until: now + WHEEL_WRAP_BLOCK_MS };
      setSelectedIndex(0, "next", true);
      return;
    }

    if (current === 0 && wheelDirection === "previous" && gestureStartIndex === 0) {
      event.preventDefault();
      wheelWrapBlockRef.current = { direction: "previous", until: now + WHEEL_WRAP_BLOCK_MS };
      setSelectedIndex(gallery.length - 1, "previous", true);
    }
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
        className={`relative aspect-[4/5] w-full overflow-hidden bg-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-400 ${
          wrapCueDirection ? `gallery-wrap-cue-${wrapCueDirection}` : ""
        }`}
        tabIndex={gallery.length > 1 ? 0 : -1}
        onKeyDown={handleKeyDown}
        style={{ overscrollBehaviorX: "contain" }}
        aria-label={gallery.length > 1 ? `${title} gallery. Use arrow keys or swipe to change images.` : `${title} gallery`}
      >
        {hasImages ? (
          <div
            ref={viewportRef}
            data-gallery-viewport
            className="gallery-scroll h-full overflow-x-auto overflow-y-hidden"
            onScroll={handleScroll}
            onWheel={handleWheel}
          >
            <div className="flex h-full">
              {gallery.map((imageUrl, index) => (
                <div key={`${imageUrl}-${index}`} className="gallery-slide h-full min-w-0 flex-[0_0_100%]">
                  <img
                    src={imageUrl}
                    alt={`${title} image ${index + 1}`}
                    className={`h-full w-full object-cover select-none gallery-image-${transitionDirection} ${
                      index === activeIndex ? "gallery-image-selected" : "gallery-image-idle"
                    }`}
                    loading="lazy"
                    draggable={false}
                  />
                </div>
              ))}
            </div>
          </div>
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
            <div
              data-gallery-counter
              className="rounded border border-neutral-300 bg-white/90 px-2 py-1 text-[11px] uppercase tracking-[0.12em] text-neutral-700"
            >
              {activeIndex + 1} / {gallery.length}
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
                index === activeIndex ? "border-neutral-700" : "border-neutral-300"
              }`}
              onClick={() => scrollTo(index)}
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
        .gallery-scroll {
          scrollbar-width: none;
          scroll-snap-type: x mandatory;
          touch-action: pan-y pinch-zoom;
        }

        .gallery-scroll::-webkit-scrollbar {
          display: none;
        }

        .gallery-slide {
          scroll-snap-align: start;
        }

        @media (pointer: coarse) {
          .gallery-slide {
            scroll-snap-stop: always;
          }
        }

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

        .gallery-image-next,
        .gallery-image-previous {
          transition: opacity 180ms ease-out;
        }

        .gallery-image-selected {
          opacity: 1;
        }

        .gallery-image-idle {
          opacity: 0.92;
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
          .gallery-scroll {
            scroll-behavior: auto;
          }

          .gallery-image-next,
          .gallery-image-previous {
            transition-duration: 0ms;
          }

          .gallery-wrap-cue-next::after,
          .gallery-wrap-cue-previous::after {
            animation: none;
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}
