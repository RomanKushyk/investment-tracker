import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

/**
 * An element's distance from the top of the DOCUMENT, published on it as the custom property
 * `name`, so a scroll box can size itself against the viewport (*Scrolling*). Measured, because a
 * sum of the parts above misses whatever moves them; document-relative, so a scrolled page does
 * not feed its own offset back into the box's height.
 */
export function useDocumentTop(name: `--${string}`) {
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef(-1);

  const measure = useCallback(() => {
    const el = ref.current;
    if (el === null) return;
    const top = Math.round(el.getBoundingClientRect().top + window.scrollY);
    // Not an optimisation: an unguarded write from an observer this property resizes loops.
    if (top === last.current) return;
    last.current = top;
    el.style.setProperty(name, `${top}px`);
  }, [name]);

  useLayoutEffect(measure);

  // An observer watches size and this publishes a position, so it watches what resizes when the
  // element moves: `main` loses the header's height, while `body` is floored at the viewport.
  // A re-render does not catch it, since the router hands React the same route element.
  useEffect(() => {
    const el = ref.current;
    const main = el?.closest('main');
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    if (main !== null && main !== undefined) observer.observe(main);
    if (el !== null) observer.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure]);

  return ref;
}
