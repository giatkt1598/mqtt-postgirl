import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

interface ScrollAreaProps {
  children: ReactNode;
  className?: string;
}

type ScrollMetrics = {
  thumbHeight: number;
  thumbTop: number;
  overflow: boolean;
};

const hiddenMetrics: ScrollMetrics = {
  thumbHeight: 0,
  thumbTop: 0,
  overflow: false,
};

export function ScrollArea({ children, className = "" }: ScrollAreaProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [metrics, setMetrics] = useState<ScrollMetrics>(hiddenMetrics);
  const [visible, setVisible] = useState(false);

  const recalculate = () => {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!viewport || !track) return;

    const overflow = viewport.scrollHeight > viewport.clientHeight;
    if (!overflow) {
      setMetrics(hiddenMetrics);
      return;
    }

    const trackHeight = track.clientHeight;
    const thumbHeight = Math.max(
      24,
      Math.round((viewport.clientHeight / viewport.scrollHeight) * trackHeight),
    );
    const maxThumbTop = Math.max(trackHeight - thumbHeight, 0);
    const maxScrollTop = Math.max(viewport.scrollHeight - viewport.clientHeight, 1);
    setMetrics({
      overflow: true,
      thumbHeight,
      thumbTop: Math.round((viewport.scrollTop / maxScrollTop) * maxThumbTop),
    });
  };

  const showTemporarily = () => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    setVisible(true);
    hideTimerRef.current = setTimeout(() => setVisible(false), 650);
  };

  useLayoutEffect(() => {
    recalculate();
    const viewport = viewportRef.current;
    if (!viewport) return undefined;
    const observer = new ResizeObserver(recalculate);
    observer.observe(viewport);
    if (viewport.firstElementChild) observer.observe(viewport.firstElementChild);
    window.addEventListener("resize", recalculate);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", recalculate);
    };
  }, []);

  useEffect(
    () => () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    },
    [],
  );

  const handleScroll = () => {
    recalculate();
    showTemporarily();
  };

  const handleThumbPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!viewport || !track) return;
    event.preventDefault();
    const startY = event.clientY;
    const startScrollTop = viewport.scrollTop;
    const maxScrollTop = viewport.scrollHeight - viewport.clientHeight;
    const maxThumbTop = track.clientHeight - metrics.thumbHeight;
    const onPointerMove = (moveEvent: PointerEvent) => {
      if (maxThumbTop <= 0) return;
      viewport.scrollTop = startScrollTop + ((moveEvent.clientY - startY) / maxThumbTop) * maxScrollTop;
    };
    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    showTemporarily();
  };

  const handleTrackPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!viewport || !track || !metrics.overflow) return;
    const relativeY = event.clientY - track.getBoundingClientRect().top;
    const maxThumbTop = track.clientHeight - metrics.thumbHeight;
    const maxScrollTop = viewport.scrollHeight - viewport.clientHeight;
    viewport.scrollTop = Math.max(
      0,
      Math.min(maxScrollTop, ((relativeY - metrics.thumbHeight / 2) / maxThumbTop) * maxScrollTop),
    );
    showTemporarily();
  };

  return (
    <div
      className={`scroll-area ${className}`.trim()}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => {
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
        setVisible(false);
      }}
    >
      <div ref={viewportRef} className="scroll-area-viewport" onScroll={handleScroll}>
        <div className="scroll-area-content">{children}</div>
      </div>
      <div
        ref={trackRef}
        className={`scroll-area-track ${metrics.overflow ? "is-overflowing" : ""}`}
        onPointerDown={handleTrackPointerDown}
      >
        <div
          className={`scroll-area-thumb ${visible ? "is-visible" : ""}`}
          style={{ height: metrics.thumbHeight, transform: `translateY(${metrics.thumbTop}px)` }}
          onPointerDown={handleThumbPointerDown}
        />
      </div>
    </div>
  );
}
