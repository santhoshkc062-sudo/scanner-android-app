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

import { PackingLine, StationStatus, SystemChip } from './packing-line';
import { toPackingLine } from './smes-data';
import { BoardFeed, LINE_KEY, SERVER_KEY, normaliseServer } from './services/board-feed';

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

/** Storage can throw in a locked-down WebView; the board must still come up. */
function readStore(key: string): string {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

function writeStore(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* not persisted — the TV asks again after a reboot */
  }
}

/** What shows before the first fetch lands. */
const EMPTY_LINE: PackingLine = {
  code: '—',
  name: 'Connecting…',
  shift: { name: '—', code: '—', start: '--:--', end: '--:--' },
  customer: '—',
  anchors: [],
  systems: [],
};

/**
 * The packing-line board, for the TV on the floor.
 *
 * Everything shown is read from `line`, which is built from the SMES server's
 * lines and anchor mappings (BoardFeed) — kept live by the server's
 * `anchorMappingUpdate` socket push. The totals are derived rather than
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
  host: { '(document:keydown)': 'onKey($event)' },
})
export class AppComponent {
  readonly feed = inject(BoardFeed);

  /** Null until the browser takes over, so the pre-rendered page carries no stale time. */
  readonly now = signal<Date | null>(null);

  /** The clock to the minute. `line` reads this rather than `now`: an equal
   *  value stops the signal graph, so the board is rebuilt when data lands or
   *  the minute (and so perhaps the shift) turns — not on every second's tick,
   *  which a TV's CPU pays for in every card. */
  private readonly minute = computed(() => {
    const t = this.now();
    return t ? Math.floor(t.getTime() / 60_000) : 0;
  });

  /** Server address as saved, e.g. 192.168.1.5:3001. */
  readonly server = signal('');
  /** The line this TV is pinned to; empty means "the first line". */
  readonly pinnedLine = signal('');

  readonly settingsOpen = signal(false);
  /** Settings form drafts — applied only on Save. */
  readonly draftServer = signal('');
  readonly draftLine = signal('');

  /** Lines the server knows, for the picker. */
  readonly lines = computed(() =>
    [...(this.feed.snapshot()?.lines || [])].sort((a, b) =>
      (a.LINE_CODE || '').localeCompare(b.LINE_CODE || ''),
    ),
  );

  /** Nothing pinned yet: the first line, so a fresh TV is never blank. */
  readonly lineCode = computed(() => this.pinnedLine() || this.lines()[0]?.LINE_CODE || '');

  readonly systems = computed<SystemChip[]>(() => {
    const status = this.feed.status();
    const updated = this.feed.updatedAt();
    const chips: SystemChip[] = [
      status === 'live'
        ? { label: 'Live', detail: 'socket', tone: 'ok' }
        : status === 'connecting'
          ? { label: 'Connecting', tone: 'info' }
          : { label: 'Offline', detail: 'polling', tone: 'warn' },
    ];
    if (this.feed.fetchError()) chips.push({ label: 'Server unreachable', tone: 'warn' });
    if (updated) {
      const hh = String(updated.getHours()).padStart(2, '0');
      const mm = String(updated.getMinutes()).padStart(2, '0');
      const ss = String(updated.getSeconds()).padStart(2, '0');
      chips.push({ label: 'Updated', detail: `${hh}:${mm}:${ss}`, tone: 'plain' });
    }
    return chips;
  });

  readonly line = computed<PackingLine>(() => {
    const snap = this.feed.snapshot();
    if (!snap) {
      const name = this.server() ? 'Connecting…' : 'Set the server address';
      return { ...EMPTY_LINE, name, systems: this.systems() };
    }
    const minute = this.minute();
    return toPackingLine(snap, this.lineCode(), this.systems(), minute ? new Date(minute * 60_000) : new Date());
  });

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
        range: !first ? 'none mapped' : first === last ? first : `${first} – ${last}`,
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
    // keeps the build time out of the page — and the feed off the build
    // machine: it ships "--:--:--" and both start on the device.
    afterNextRender(() => {
      const tick = () => this.now.set(new Date());
      tick();
      const timer = setInterval(tick, 1000);
      destroyRef.onDestroy(() => {
        clearInterval(timer);
        this.feed.stop();
      });

      // ?server=192.168.1.5:3001&line=L104 pins a browser tab; the TV itself
      // keeps whatever was saved in settings.
      const params = new URLSearchParams(location.search);
      const server = params.get('server') || readStore(SERVER_KEY);
      const lineCode = params.get('line') || readStore(LINE_KEY);
      if (params.get('server')) writeStore(SERVER_KEY, server);
      if (params.get('line')) writeStore(LINE_KEY, lineCode);

      this.server.set(server);
      this.pinnedLine.set(lineCode);
      if (server) this.feed.start(server);
      else this.openSettings();
    });
  }

  // ── Settings ────────────────────────────────────────────────────────────────
  // A TV has no address bar, so the server and line are chosen here with the
  // remote: the Settings chip, or the Menu key.

  openSettings(): void {
    this.draftServer.set(this.server());
    this.draftLine.set(this.lineCode());
    this.settingsOpen.set(true);
    // Focus the first field so the remote's D-pad lands inside the panel.
    setTimeout(() => (document.getElementById('pl-set-server') as HTMLInputElement | null)?.focus());
  }

  /** Connects to the drafted address so its lines can be picked before saving. */
  connectDraft(): void {
    const server = this.draftServer().trim();
    if (!server || normaliseServer(server) === normaliseServer(this.server())) return;
    this.server.set(server);
    this.feed.snapshot.set(null);
    this.feed.start(server);
  }

  saveSettings(): void {
    const server = this.draftServer().trim();
    if (!server) return;
    if (normaliseServer(server) !== normaliseServer(this.server())) this.connectDraft();

    writeStore(SERVER_KEY, server);
    writeStore(LINE_KEY, this.draftLine());
    this.pinnedLine.set(this.draftLine());
    this.settingsOpen.set(false);
  }

  cancelSettings(): void {
    // Without a server there is nothing to go back to.
    if (this.server()) this.settingsOpen.set(false);
  }

  onKey(e: KeyboardEvent): void {
    if (this.settingsOpen()) {
      if (e.key === 'Escape' || e.key === 'GoBack') this.cancelSettings();
      return;
    }
    if (e.key === 'ContextMenu' || e.key === 'Menu' || e.key === 's' || e.key === 'S') {
      e.preventDefault();
      this.openSettings();
    }
  }

  valueOf(e: Event): string {
    return (e.target as HTMLInputElement | HTMLSelectElement).value;
  }
}
