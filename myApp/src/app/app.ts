import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';

import { PackingLine, SAMPLE_LINE, StationStatus } from './packing-line';

const STATUS_LABEL: Record<StationStatus, string> = {
  running: 'Running',
  waiting: 'Waiting',
  completed: 'Completed',
  breakdown: 'Breakdown',
  idle: 'Idle',
};

/** Whole-number percentage; 0 when there is no target to measure against. */
function percent(done: number, target: number): number {
  return target > 0 ? Math.round((done / target) * 100) : 0;
}

/**
 * The packing-line board, for the TV on the floor.
 *
 * Everything shown is read from `line`. The totals are derived rather than
 * stored — an anchor's packed / target, the line's overall progress and the
 * completion figure are sums over the stations — so the header, the anchor
 * bars and the cards can never disagree with one another.
 */
@Component({
  selector: 'app-root',
  imports: [DatePipe, DecimalPipe],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {
  /** The line on show. Sample data for now; set it from the server to go live. */
  readonly line = signal<PackingLine>(SAMPLE_LINE);

  /** Null until the browser takes over, so the pre-rendered page carries no stale time. */
  readonly now = signal<Date | null>(null);

  readonly anchors = computed(() =>
    this.line().anchors.map((anchor) => {
      const stations = anchor.stations.map((s) => {
        const pct = percent(s.packed, s.target);
        return { ...s, label: STATUS_LABEL[s.status], pct, bar: Math.min(pct, 100) };
      });
      const packed = stations.reduce((n, s) => n + s.packed, 0);
      const target = stations.reduce((n, s) => n + s.target, 0);
      const first = stations[0]?.code ?? '';
      const last = stations[stations.length - 1]?.code ?? '';
      return {
        ...anchor,
        stations,
        packed,
        target,
        pct: percent(packed, target),
        range: first === last ? first : `${first} – ${last}`,
      };
    }),
  );

  readonly totals = computed(() => {
    const packed = this.anchors().reduce((n, a) => n + a.packed, 0);
    const target = this.anchors().reduce((n, a) => n + a.target, 0);
    const pct = percent(packed, target);
    return { packed, target, pct, bar: Math.min(pct, 100) };
  });

  constructor() {
    const destroyRef = inject(DestroyRef);

    // afterNextRender never runs during the build's pre-render, which is what
    // keeps the build time out of the page: it ships "--:--:--" and the clock
    // starts on the device.
    afterNextRender(() => {
      const tick = () => this.now.set(new Date());
      tick();
      const timer = setInterval(tick, 1000);
      destroyRef.onDestroy(() => clearInterval(timer));
    });
  }
}
