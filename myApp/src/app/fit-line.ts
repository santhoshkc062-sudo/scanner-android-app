import { Directive, ElementRef, afterRenderEffect, inject, input, signal } from '@angular/core';

/** The smallest share of its styled size a line is set at to fit. Text still
 *  too long at that ends in the stylesheet's ellipsis instead. */
const FIT_MIN = 0.6;

/**
 * Keeps a line of text whole on one line. Text wider than its box is set
 * smaller, by just enough, through a `--fit` factor on the element: its styles
 * keep it to one line and scale the font size by `var(--fit, 1)`.
 *
 * It measures when the text or the window changes, not on every render, so
 * the clock re-rendering the cards each second costs no layout.
 */
@Directive({
  selector: '[appFitLine]',
  host: { '(window:resize)': 'onResize()' },
})
export class FitLine {
  /** The text shown, so that a new one is measured. */
  readonly appFitLine = input.required<string>();

  private readonly resized = signal(0);

  constructor() {
    const el: HTMLElement = inject(ElementRef).nativeElement;
    afterRenderEffect(() => {
      this.appFitLine();
      this.resized();
      el.style.removeProperty('--fit');
      const room = el.clientWidth;
      const need = el.scrollWidth;
      if (room > 0 && need > room) {
        // A shade under the exact ratio: glyph widths round a little
        // differently at each size.
        el.style.setProperty('--fit', String(Math.max(FIT_MIN, (0.98 * room) / need)));
      }
    });
  }

  protected onResize(): void {
    this.resized.update((n) => n + 1);
  }
}
