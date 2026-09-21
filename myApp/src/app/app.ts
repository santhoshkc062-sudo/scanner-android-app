import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  ViewEncapsulation,
  afterNextRender,
} from '@angular/core';

import { startTvDemo } from './tv-demo';

/**
 * The board.
 *
 * The template is the pasted page's markup and nothing else; its stylesheets
 * are global in src/styles.css and its scripts are in ./tv-demo.ts.
 * See the comment at the head of either file for why they cannot live in a
 * component template.
 *
 * There is no state here on purpose. The loop drives the DOM directly, the way
 * it was written to, so there is nothing for change detection to do — hence
 * OnPush and an empty class.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  templateUrl: './app.html',
  // The board's CSS is global (src/styles.css) and reaches html, body and the
  // chrome the engine appends to <body>. Emulated encapsulation here would add
  // per-component attributes to the template's elements but not to the ones the
  // engine creates at runtime, so the two halves of one board would be styled
  // by different rules. None keeps them the same.
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent implements OnDestroy {
  private stop: (() => void) | null = null;

  constructor() {
    // afterNextRender rather than ngAfterViewInit: it never runs on the server,
    // and it runs after hydration has finished claiming the markup — the engine
    // rewrites that markup, so starting it any earlier races hydration.
    afterNextRender(() => {
      this.stop = startTvDemo();
    });
  }

  ngOnDestroy(): void {
    this.stop?.();
    this.stop = null;
  }
}
