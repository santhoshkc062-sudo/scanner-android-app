import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type IconName =
  | 'alert'
  | 'board'
  | 'chevron'
  | 'clock'
  | 'cube'
  | 'gear'
  | 'hourglass'
  | 'layers'
  | 'list'
  // Drawn on a 64 grid, in its own colours:
  | 'box-open';

const LARGE: ReadonlySet<IconName> = new Set<IconName>(['box-open']);

/**
 * The dark board's icons and its one picture, drawn inline — the TV downloads
 * nothing. Put it on an <svg>: `<svg appIcon="clock"></svg>`. The line icons
 * take their colour from `color`; the picture carries its own. The size is
 * the stylesheet's to set.
 */
@Component({
  selector: 'svg[appIcon]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.viewBox]': 'viewBox()',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.8',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    focusable: 'false',
  },
  template: `
    @switch (appIcon()) {
      @case ('alert') {
        <svg:path fill="currentColor" stroke="none"
                  d="M10.27 3.9 1.99 18.2a2 2 0 0 0 1.73 3h16.56a2 2 0 0 0 1.73-3L13.73 3.9a2 2 0 0 0-3.46 0z" />
        <svg:path stroke="#1a0c12" stroke-width="2.3" d="M12 9.2v4.6" />
        <svg:circle fill="#1a0c12" stroke="none" cx="12" cy="17.3" r="1.3" />
      }
      @case ('board') {
        <svg:rect x="3.2" y="3.2" width="17.6" height="17.6" rx="2.4" />
        <svg:path d="M3.2 9h17.6M9.4 9v11.8" />
      }
      @case ('chevron') {
        <svg:path d="m9 5.5 6.5 6.5L9 18.5" />
      }
      @case ('clock') {
        <svg:circle cx="12" cy="12" r="9" />
        <svg:path d="M12 7v5l3.2 2" />
      }
      @case ('cube') {
        <svg:path d="M12 2.6 20.4 7v10L12 21.4 3.6 17V7z" />
        <svg:path d="M3.6 7 12 11.4 20.4 7M12 11.4v10" />
      }
      @case ('gear') {
        <svg:path
          d="M19.38 10.17 21.86 10.36 21.86 13.64 19.38 13.83 18.51 15.92 20.14 17.81 17.81 20.14 15.92 18.51 13.83 19.38 13.64 21.86 10.36 21.86 10.17 19.38 8.08 18.51 6.19 20.14 3.86 17.81 5.49 15.92 4.62 13.83 2.14 13.64 2.14 10.36 4.62 10.17 5.49 8.08 3.86 6.19 6.19 3.86 8.08 5.49 10.17 4.62 10.36 2.14 13.64 2.14 13.83 4.62 15.92 5.49 17.81 3.86 20.14 6.19 18.51 8.08z" />
        <svg:circle cx="12" cy="12" r="3.1" />
      }
      @case ('hourglass') {
        <svg:path d="M6.5 3h11M6.5 21h11" />
        <svg:path d="M7.5 3c0 4.8 4.5 6 4.5 9s-4.5 4.2-4.5 9M16.5 3c0 4.8-4.5 6-4.5 9s4.5 4.2 4.5 9" />
      }
      @case ('layers') {
        <svg:path d="M12 3.2 2.8 7.8l9.2 4.6 9.2-4.6z" />
        <svg:path d="m2.8 12.2 9.2 4.6 9.2-4.6M2.8 16.4l9.2 4.6 9.2-4.6" />
      }
      @case ('list') {
        <svg:rect x="4" y="3.2" width="16" height="17.6" rx="2.2" />
        <svg:path d="M8 8.4h8M8 12h8M8 15.6h5" />
      }
      @case ('box-open') {
        <!-- An open carton: back flaps up, the dark inside, two faces, front flaps out. -->
        <svg:g stroke="none">
          <svg:path fill="#5a7aa3" d="M10 20 32 10l-6-8L4 12z" />
          <svg:path fill="#4b6a93" d="m32 10 22 10 6-8-22-10z" />
          <svg:path fill="#15253a" d="M10 20 32 10l22 10-22 10z" />
          <svg:path fill="#4d6c94" d="M10 20 32 30v26L10 46z" />
          <svg:path fill="#3b5679" d="M54 20 32 30v26l22-10z" />
          <svg:path fill="#6b8bb5" d="M10 20 32 30l-10 7L0 27z" />
          <svg:path fill="#5f80aa" d="m54 20-22 10 10 7 22-10z" />
        </svg:g>
      }
    }
  `,
})
export class Icon {
  readonly appIcon = input.required<IconName>();

  protected readonly viewBox = computed(() => (LARGE.has(this.appIcon()) ? '0 0 64 64' : '0 0 24 24'));
}
