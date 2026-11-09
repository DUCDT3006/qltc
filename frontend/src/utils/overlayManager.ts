import { useEffect, useRef, type RefObject } from 'react';

interface OverlayEntry {
  element: HTMLElement;
  onClose: () => void;
  restoreFocus: HTMLElement | null;
  initialFocus: HTMLElement | null;
}

const overlays: OverlayEntry[] = [];
const originalInertState = new Map<HTMLElement, boolean>();

function getTopOverlay(): OverlayEntry | undefined {
  return overlays.reduce<OverlayEntry | undefined>((top, candidate) => {
    if (!top) return candidate;
    if (top.element.contains(candidate.element)) return candidate;
    if (candidate.element.contains(top.element)) return top;

    const topZ = Number.parseInt(getComputedStyle(top.element).zIndex, 10) || 0;
    const candidateZ = Number.parseInt(getComputedStyle(candidate.element).zIndex, 10) || 0;
    if (candidateZ !== topZ) return candidateZ > topZ ? candidate : top;
    return top.element.compareDocumentPosition(candidate.element) & Node.DOCUMENT_POSITION_FOLLOWING
      ? candidate
      : top;
  }, undefined);
}

function restoreInertState() {
  for (const [element, wasInert] of originalInertState) element.inert = wasInert;
  originalInertState.clear();
}

function updateBackgroundInert(top: OverlayEntry | undefined) {
  restoreInertState();
  if (!top) return;

  let branch: HTMLElement = top.element;
  let parent = branch.parentElement;
  while (parent) {
    for (const sibling of Array.from(parent.children)) {
      if (sibling === branch || !(sibling instanceof HTMLElement)) continue;
      if (!originalInertState.has(sibling)) originalInertState.set(sibling, sibling.inert);
      sibling.inert = true;
    }
    branch = parent;
    parent = branch.parentElement;
  }
}

function handleOverlayKeyDown(event: KeyboardEvent) {
  const top = getTopOverlay();
  if (!top) return;

  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    top.onClose();
    return;
  }
  if (event.key !== 'Tab') return;

  const focusable = Array.from(top.element.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter((element) => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true');

  if (focusable.length === 0) {
    event.preventDefault();
    top.element.focus();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && (document.activeElement === first || !top.element.contains(document.activeElement))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (document.activeElement === last || !top.element.contains(document.activeElement))) {
    event.preventDefault();
    first.focus();
  }
}

let keyListenerInstalled = false;

function installKeyListener() {
  if (keyListenerInstalled) return;
  document.addEventListener('keydown', handleOverlayKeyDown);
  keyListenerInstalled = true;
}

function removeKeyListenerIfIdle() {
  if (!keyListenerInstalled || overlays.length > 0) return;
  document.removeEventListener('keydown', handleOverlayKeyDown);
  keyListenerInstalled = false;
}

export function closeTopOverlay(): boolean {
  const top = getTopOverlay();
  if (!top) return false;
  top.onClose();
  return true;
}

export function isTopOverlay(element: HTMLElement): boolean {
  return getTopOverlay()?.element === element;
}

export function useManagedOverlay(
  isOpen: boolean,
  onClose: () => void,
  accessibleName: string,
  initialFocusRef?: RefObject<HTMLElement | null>
) {
  const elementRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const initialFocusRefLocal = useRef(initialFocusRef);

  useEffect(() => {
    onCloseRef.current = onClose;
    initialFocusRefLocal.current = initialFocusRef;
  }, [onClose, initialFocusRef]);

  useEffect(() => {
    if (!isOpen || !elementRef.current) return;

    const entry: OverlayEntry = {
      element: elementRef.current,
      onClose: () => onCloseRef.current(),
      restoreFocus: document.activeElement instanceof HTMLElement ? document.activeElement : null,
      initialFocus: initialFocusRefLocal.current?.current ?? null
    };
    overlays.push(entry);
    installKeyListener();
    updateBackgroundInert(getTopOverlay());
    (entry.initialFocus ?? entry.element).focus();

    return () => {
      const index = overlays.indexOf(entry);
      if (index !== -1) overlays.splice(index, 1);
      updateBackgroundInert(getTopOverlay());
      removeKeyListenerIfIdle();
      if (entry.restoreFocus?.isConnected && !entry.restoreFocus.closest('[inert]')) entry.restoreFocus.focus();
    };
  }, [isOpen]);

  return {
    ref: elementRef,
    role: 'dialog' as const,
    'aria-modal': true as const,
    'aria-label': accessibleName,
    tabIndex: -1
  };
}
