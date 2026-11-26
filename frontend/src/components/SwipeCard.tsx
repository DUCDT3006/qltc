import { useEffect, useRef, type PointerEvent, type ReactNode } from 'react';

interface SwipeCardProps {
  children: ReactNode;
  className: string;
  canApprove: boolean;
  onApprove: () => void;
  onReject: () => void;
}

interface Drag {
  pointerId: number;
  startX: number;
  startY: number;
  width: number;
  horizontal: boolean;
  offset: number;
}

export function SwipeCard({ children, className, canApprove, onApprove, onReject }: SwipeCardProps) {
  const card = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const frame = useRef<number | null>(null);

  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    drag.current = null;
  }, []);

  const reset = () => {
    const pointerId = drag.current?.pointerId;
    drag.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    const node = card.current;
    if (!node) return;
    delete node.dataset.dragging;
    node.style.transform = '';
    node.style.setProperty('--swipe-approve-opacity', '0');
    node.style.setProperty('--swipe-reject-opacity', '0');
    if (pointerId !== undefined && node.hasPointerCapture(pointerId)) node.releasePointerCapture(pointerId);
  };

  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0) { reset(); return; }
    if (event.target instanceof Element && event.target.closest('input, textarea, button, select, a, label, summary, [contenteditable], [role="button"]')) return;
    reset();
    drag.current = {
      pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      width: event.currentTarget.clientWidth, horizontal: false, offset: 0
    };
    event.currentTarget.dataset.dragging = 'true';
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const move = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const x = event.clientX - current.startX;
    const y = event.clientY - current.startY;
    if (!current.horizontal) {
      if (Math.max(Math.abs(x), Math.abs(y)) < 8) return;
      if (Math.abs(y) >= Math.abs(x)) { reset(); return; }
      current.horizontal = true;
    }
    current.offset = Math.max(-current.width, Math.min(current.width, x));
    if (frame.current !== null) return;
    // Moving the card never updates React state or renders the transaction queue.
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const node = card.current;
      const offset = drag.current?.offset ?? 0;
      if (!node) return;
      node.style.transform = `translate3d(${offset}px, 0, 0) rotate(${offset * 0.04}deg)`;
      node.style.setProperty('--swipe-approve-opacity', String(canApprove ? Math.max(0, Math.min(1, (offset - 20) / 70)) : 0));
      node.style.setProperty('--swipe-reject-opacity', String(Math.max(0, Math.min(1, (-offset - 20) / 70))));
    });
  };

  const finish = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const offset = event.clientX - current.startX;
    const horizontal = current.horizontal;
    reset();
    if (!horizontal) return;
    if (offset > 90 && canApprove) {
      if (card.current && !card.current.classList.contains('qltc-swipe-defer-approve')) {
        card.current.dataset.swipeExit = 'approve';
      }
      onApprove();
    } else if (offset < -90) {
      if (card.current) card.current.dataset.swipeExit = 'reject';
      onReject();
    }
  };

  const cancel = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId === event.pointerId) reset();
  };

  return <div ref={card} data-swipe-card className={'qltc-swipe-card ' + className}
    onPointerDown={start} onPointerMove={move} onPointerUp={finish}
    onPointerCancel={cancel} onLostPointerCapture={cancel}>
    {children}
  </div>;
}
