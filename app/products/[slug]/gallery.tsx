"use client";

import { KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { WheelGesturesPlugin } from "embla-carousel-wheel-gestures";

type Props = {
  title: string;
  images: string[];
};

type GalleryDirection = "previous" | "next";

const WRAP_CUE_MS = 240;

function normalizeImages(images: string[]) {
  return images.map((item) => item.trim()).filter(Boolean);
}

export default function ProductGallery({ title, images }: Props) {
  const gallery = useMemo(() => normalizeImages(images), [images]);
  const wheelPlugins = useMemo(
    () => (gallery.length > 1 ? [WheelGesturesPlugin({ forceWheelAxis: "x" })] : []),
    [gallery.length]
  );
  const [emblaRef, emblaApi] = useEmblaCarousel(
    {
      align: "start",
      loop: gallery.length > 1,
      skipSnaps: false
    },
    wheelPlugins
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const [transitionDirection, setTransitionDirection] = useState<GalleryDirection>("next");
  const [wrapCueDirection, setWrapCueDirection] = useState<GalleryDirection | null>(null);
  const thumbnailStripRef = useRef<HTMLDivElement | null>(null);
  const activeIndexRef = useRef(0);
  const wrapCueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    };
  }, []);

  const triggerWrapCue = useCallback((direction: GalleryDirection) => {
    if (wrapCueTimerRef.current) {
      clearTimeout(wrapCueTimerRef.current);
    }

    setWrapCueDirection(direction);
    wrapCueTimerRef.current = setTimeout(() => {
      setWrapCueDirection(null);
      wrapCueTimerRef.current = null;
    }, WRAP_CUE_MS);
  }, []);

  const syncSelection = useCallback(() => {
    if (!emblaApi) {
      return;
    }

    const nextIndex = emblaApi.selectedScrollSnap();
    const previousIndex = activeIndexRef.current;
    if (gallery.length > 1) {
      if (previousIndex === gallery.length - 1 && nextIndex === 0) {
        triggerWrapCue("next");
      } else if (previousIndex === 0 && nextIndex === gallery.length - 1) {
        triggerWrapCue("previous");
      }
    }

    setTransitionDirection(nextIndex >= previousIndex ? "next" : "previous");
    activeIndexRef.current = nextIndex;
    setActiveIndex(nextIndex);
  }, [emblaApi, gallery.length, triggerWrapCue]);

  useEffect(() => {
    if (!emblaApi) {
      return;
    }

    syncSelection();
    emblaApi.on("select", syncSelection);
    emblaApi.on("reInit", syncSelection);

    return () => {
      emblaApi.off("select", syncSelection);
      emblaApi.off("reInit", syncSelection);
    };
  }, [emblaApi, syncSelection]);

  useEffect(() => {
    emblaApi?.reInit();
  }, [emblaApi, gallery.length]);

  function prev() {
    setTransitionDirection("previous");
    emblaApi?.scrollPrev();
  }

  function next() {
    setTransitionDirection("next");
    emblaApi?.scrollNext();
  }

  function scrollTo(index: number) {
    if (!emblaApi || index === activeIndex) {
      return;
    }

    setTransitionDirection(index > activeIndex ? "next" : "previous");
    emblaApi.scrollTo(index);
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
        style={{ overscrollBehaviorX: "contain" }}
        aria-label={gallery.length > 1 ? `${title} gallery. Use arrow keys or swipe to change images.` : `${title} gallery`}
      >
        {hasImages ? (
          <div ref={emblaRef} data-gallery-viewport className="h-full overflow-hidden">
            <div className="flex h-full touch-pan-y">
              {gallery.map((imageUrl, index) => (
                <div key={`${imageUrl}-${index}`} className="h-full min-w-0 flex-[0_0_100%]">
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
            <div className="rounded border border-neutral-300 bg-white/90 px-2 py-1 text-[11px] uppercase tracking-[0.12em] text-neutral-700">
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
