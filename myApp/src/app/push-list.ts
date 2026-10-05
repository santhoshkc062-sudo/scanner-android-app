import { DestroyRef, Directive, ElementRef, afterNextRender, inject } from '@angular/core';

/** How long the rows take to slide into their new places. */
const PUSH_MS = 700;

/** The viewer has asked for less motion. */
const calm = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Slides a newest-first list down when rows arrive at its top, rather than
 * letting the rows below jump: the new rows come in from above the list's top
 * edge, where the list clips them, and the rows already there glide down by as
 * much — together, as one push. Put it on the list itself:
 * `<div class="pl-boxlist" appPushList>`.
 *
 * It watches the list's children, so it moves only for rows really added — not
 * for a class changing, or the same rows fetched again. Rows the list has
 * wrapped out of sight (the column wrap in the stylesheets) are left alone,
 * and nothing moves for a viewer who has asked for less motion.
 */
@Directive({ selector: '[appPushList]' })
export class PushList {
  constructor() {
    const list: HTMLElement = inject(ElementRef).nativeElement;
    const destroyRef = inject(DestroyRef);

    afterNextRender(() => {
      // The Web Animations API moves the rows; a screen without it just jumps.
      if (typeof MutationObserver === 'undefined' || typeof list.animate !== 'function') return;

      let before = new Set(Array.from(list.children));
      const observer = new MutationObserver(() => {
        const rows = Array.from(list.children) as HTMLElement[];
        const seen = before;
        before = new Set(rows);
        // The first row that was there before: every row above it is new.
        const kept = rows.findIndex((r) => seen.has(r));
        if (kept <= 0 || calm()) return;
        // How far the new rows pushed the old ones down. offsetTop, not the
        // bounding box, so a push still running does not skew the next one.
        const by = rows[kept].offsetTop - rows[0].offsetTop;
        if (by <= 0) return;
        const column = rows[0].offsetLeft;
        for (const row of rows) {
          // Wrapped out of sight, and so is every row after it.
          if (row.offsetLeft !== column) break;
          row.animate([{ transform: `translateY(${-by}px)` }, { transform: 'none' }], {
            duration: PUSH_MS,
            easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
          });
        }
      });
      observer.observe(list, { childList: true });
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }
}
