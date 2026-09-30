import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  afterNextRender,
  computed,
  effect,
  inject,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';

import { FitLine } from './fit-line';
import { Icon } from './icon';
import { PackingLine, Station, StationStatus, SystemChip } from './packing-line';
import { NO_SHIFT, PartCompletion, toPackingLine } from './smes-data';
import { BoardFeed, LINE_KEY, SERVER_KEY, normaliseServer } from './services/board-feed';

const STATUS_LABEL: Record<StationStatus, string> = {
  running: 'Running',
  waiting: 'Waiting',
  completed: 'Queue done',
  breakdown: 'Breakdown',
  idle: 'Idle',
};

/** How long a running station may go without a new count before its card
 *  turns red and starts timing. */
const STALL_MS = 10 * 60_000;

/** Pieces left at which a card starts pointing at what comes next, so the next
 *  box and its label are ready before this one fills: a tenth of the box, but
 *  never fewer than 2 pieces or more than 5. */
const NEAR_FULL = 5;
const nearFullAt = (target: number) => Math.max(2, Math.min(NEAR_FULL, Math.ceil(target / 10)));

/** How long a closed box is called out, on its card and in the list. */
const CLOSED_FLASH_MS = 90_000;

/** How long after the board sees a count go up the card marks it; the
 *  animation itself is over well within this. */
const BUMP_MS = 2_500;

/** The pace is read from the pieces counted within this window of the last
 *  one, and from no more than TRAIL_MAX of them. */
const PACE_WINDOW_MS = 30 * 60_000;
const TRAIL_MAX = 12;

/** How late the next piece may be, by the box's plan, before the card says the
 *  box is behind: a minute, or one piece's cycle when that is longer. Less is
 *  only the gap between one count and the next. */
const PLAN_GRACE_MS = 60_000;

/** Boxes listed down the side — as many as its height holds. */
const FEED_ROWS = 9;

/** Events listed under them on the dark board. */
const EVENT_ROWS = 8;

/** Where the count marks are saved, so a reboot resumes the stall timers. */
const MARKS_KEY = 'tvCountMarks';

/** Where the TV keeps its theme, 'dark' or 'light'. index.html reads it too,
 *  to paint the first frame dark. */
const THEME_KEY = 'tvTheme';

/** The class on <html> while the board is dark; index.html sets it at boot. */
const DARK_CLASS = 'tv-dark';

/** The box dial: a half circle of this radius, drawn by its dash offset. */
const GAUGE_ARC = Math.PI * 42;

/** What the board last read on a station, and when. */
interface CountMark {
  /** The part on the station, so a new job counts as movement too. */
  job: string;
  packed: number;
  /** The count before this one, when the board saw it change on this job. */
  from?: number;
  /** How many rises the board has seen on this job — its parity alternates
   *  the count's animation, which is what restarts it on every rise. */
  rises?: number;
  /** When the board first read this count (epoch ms). */
  at: number;
  /** `at` is a change the board saw happen, not its first look after a start. */
  watched?: boolean;
  /** Counts the board saw go up on this job, as [epoch ms, packed], oldest first. */
  trail?: [number, number][];
  /** The first pieces the board saw in the box now in hand — when, and how
   *  many — which the box's plan counts from. Mostly its first piece; more
   *  when several landed in one fetch, or the box was under way when the board
   *  first looked. Absent while the box is empty. */
  first?: { box: string; at: number; n: number };
}

/** Where a counting box stands against its plan: its part's cycle time for
 *  every piece still to go after the first. */
interface BoxPlan {
  /** When the box should be full (epoch ms). */
  due: number;
  /** Behind the plan by more than PLAN_GRACE_MS. */
  behind: boolean;
  /** Behind, with the due time a minute or more gone. */
  overdue: boolean;
  /** What the card says under the time: On plan, 6 pcs behind, Overdue 5 min. */
  note: string;
}

/** Something the board saw happen, for the Recent events list. */
interface BoardEvent {
  /** When it happened (epoch ms). */
  at: number;
  /** The machine it happened on. */
  code: string;
  text: string;
  tone: 'alert' | 'wait' | 'done';
}

/** Whole-number percentage; 0 when there is no target to measure against. */
function percent(done: number, target: number): number {
  return target > 0 ? Math.round((done / target) * 100) : 0;
}

/** 12:05, or 1:12:05 once past the hour. */
function stopwatch(ms: number): string {
  const secs = Math.floor(ms / 1000);
  const h = Math.floor(secs / 3600);
  const mm = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
  const ss = String(secs % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** "just now", "4 min ago" — minutes are as fine as a glance needs. */
function ago(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  return mins < 1 ? 'just now' : `${mins} min ago`;
}

/** 2h 05m */
function span(mins: number): string {
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
}

/** Marks are kept per line, so re-pinning the TV starts that line afresh. */
function markKey(line: PackingLine, s: Station): string {
  return `${line.code}|${s.code}`;
}

function jobKey(s: Station): string {
  return `${s.partNo}|${s.product}|${s.partName}`;
}

/** The station a closed box belongs to: its machine, which keeps its boxes if
 *  it is moved to another cell. Mirrors the fallback in Station.code. */
function boxOwner(r: PartCompletion): string {
  return r.MACHINE_CODE || `C${r.CELL_NO}`;
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

function readMarks(): Record<string, CountMark> {
  try {
    const marks = JSON.parse(readStore(MARKS_KEY) || '{}');
    return marks && typeof marks === 'object' ? marks : {};
  } catch {
    return {};
  }
}

/** What shows before the first fetch lands. */
const EMPTY_LINE: PackingLine = {
  code: '—',
  name: 'Connecting…',
  shift: NO_SHIFT,
  customer: '—',
  anchors: [],
  systems: [],
};

/**
 * The packing-line board, for the TV in front of the inspectors.
 *
 * Everything shown is read from `line`, which is built from the SMES server's
 * lines and anchor mappings (BoardFeed) — kept live by the server's
 * `anchorMappingUpdate` socket push. The totals are derived rather than
 * stored — an anchor's packed / target, the line's overall progress and the
 * completion figure are sums over the stations — so the header, the anchor
 * bars and the cards can never disagree with one another.
 *
 * Beside that it keeps what only the board can know — when it last saw each
 * count move, and so the pace and the stall timers, and when each box's first
 * piece came, which with the part's cycle time plans the box — and lists the
 * boxes the line has closed this shift.
 */
@Component({
  selector: 'app-root',
  imports: [DatePipe, DecimalPipe, FitLine, Icon],
  templateUrl: './app.html',
  styleUrls: ['./app.css', './app-dark.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown)': 'onKey($event)' },
})
export class AppComponent {
  readonly feed = inject(BoardFeed);
  readonly gaugeArc = GAUGE_ARC;

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

  /** The dark board rather than the light one. Light until the browser takes
   *  over and reads the saved theme, as the pre-rendered page is light. */
  readonly dark = signal(false);

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
    const chips: SystemChip[] = [
      status === 'live'
        ? { label: 'Live', tone: 'ok' }
        : status === 'connecting'
          ? { label: 'Connecting', tone: 'info' }
          : { label: 'Offline', detail: 'polling', tone: 'warn' },
    ];
    if (this.feed.fetchError()) chips.push({ label: 'Server unreachable', tone: 'warn' });
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
        const remaining = Math.max(0, s.target - s.packed);
        return {
          ...s,
          label: STATUS_LABEL[s.status],
          pct,
          remaining,
          gauge: GAUGE_ARC * (1 - Math.min(pct, 100) / 100),
          // Counting, and close enough to full that the next box is due.
          nearFull: s.status === 'running' && remaining > 0 && remaining <= nearFullAt(s.target),
        };
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

  /** How far the shift has run, and what is left of it. */
  readonly shiftClock = computed(() => {
    const minute = this.minute();
    const { startMin, endMin } = this.line().shift;
    if (!minute || startMin == null || endMin == null) return null;
    const at = new Date(minute * 60_000);
    const t = at.getHours() * 60 + at.getMinutes();
    const length = (endMin - startMin + 1440) % 1440 || 1440;
    const run = (t - startMin + 1440) % 1440;
    if (run > length) return null;
    return { pct: Math.round((run / length) * 100), left: span(length - run) };
  });

  /** When the shift began (ISO), for its boxes; midnight while there is none.
   *  An overnight shift that is still running began yesterday. */
  readonly shiftFrom = computed(() => {
    const minute = this.minute();
    if (!minute) return '';
    const now = new Date(minute * 60_000);
    const start = new Date(now);
    const { startMin } = this.line().shift;
    if (startMin == null) {
      start.setHours(0, 0, 0, 0);
    } else {
      start.setHours(Math.floor(startMin / 60), startMin % 60, 0, 0);
      if (start > now) start.setDate(start.getDate() - 1);
    }
    return start.toISOString();
  });

  /** When each station's count last moved, as far as this board has seen: the
   *  server keeps no time per count. Stamped with the fetch that brought the
   *  change, and the same object is handed back while nothing moves, so the
   *  save below runs only on a real change. */
  private readonly marks = linkedSignal<PackingLine, Record<string, CountMark>>({
    source: this.line,
    computation: (line, previous) => {
      const prev = previous?.value ?? readMarks();
      // Nothing fetched yet (or reconnecting): keep what the board already knows.
      if (!line.anchors.length) return prev;
      const at = this.feed.updatedAt()?.getTime() ?? Date.now();
      const next: Record<string, CountMark> = {};
      let moved = false;
      for (const anchor of line.anchors) {
        for (const s of anchor.stations) {
          const key = markKey(line, s);
          const job = jobKey(s);
          // A mark from the future means the clock was set back; start again.
          const old = prev[key] && prev[key].at <= at ? prev[key] : undefined;
          // Where the box's plan counts from: kept while the box is the same
          // one, dropped once it empties, taken afresh when a new one starts.
          const kept =
            old?.job === job && old.first?.box === s.boxId && old.first.at <= at ? old.first : undefined;
          const first = s.packed > 0 ? (kept ?? { box: s.boxId, at, n: s.packed }) : undefined;
          if (old && old.job === job && old.packed === s.packed) {
            // Nothing moved. A box that was already under way when the board
            // first looked only gains where its plan counts from.
            next[key] = old.first === first ? old : { ...old, first };
            if (next[key] !== old) moved = true;
            continue;
          }
          moved = true;
          if (old && old.job === job) {
            // The count moved on the same job, and the board saw it happen.
            const trail: [number, number][] =
              s.packed > old.packed ? [...(old.trail || []), [at, s.packed] as [number, number]].slice(-TRAIL_MAX) : [];
            const rises = (old.rises || 0) + (s.packed > old.packed ? 1 : 0);
            next[key] = { job, packed: s.packed, from: old.packed, at, watched: true, trail, rises, first };
          } else {
            // A new job the board saw arrive; with no mark at all this is only
            // the board's first look.
            next[key] = { job, packed: s.packed, at, watched: !!old, trail: [], first };
          }
        }
      }
      return moved || Object.keys(next).length !== Object.keys(prev).length ? next : prev;
    },
  });

  /** Running stations whose count has not moved for STALL_MS, by code, with
   *  how long it has been. Rebuilt every second for the timers, but it is a
   *  subtraction per station, and only a stalled card's text changes. */
  readonly stalls = computed(() => {
    const marks = this.marks();
    const now = this.now()?.getTime();
    const stalled = new Map<string, string>();
    // With the server out of reach the counts on screen are stale, and a
    // machine that is still packing would be flagged as stopped.
    if (!now || this.feed.fetchError()) return stalled;
    const line = this.line();
    for (const anchor of line.anchors) {
      for (const s of anchor.stations) {
        const at = marks[markKey(line, s)]?.at;
        if (s.status === 'running' && at != null && now - at >= STALL_MS) {
          stalled.set(s.code, stopwatch(now - at));
        }
      }
    }
    return stalled;
  });

  /** For a running station whose last piece the board saw counted: how long
   *  ago. Not shown for a first look, when the board cannot know. */
  readonly lastPiece = computed(() => {
    const marks = this.marks();
    const now = this.now()?.getTime();
    const out = new Map<string, string>();
    if (!now) return out;
    const line = this.line();
    for (const anchor of line.anchors) {
      for (const s of anchor.stations) {
        const mark = marks[markKey(line, s)];
        if (s.status === 'running' && mark?.watched) out.set(s.code, ago(Math.max(0, now - mark.at)));
      }
    }
    return out;
  });

  /** Stations whose count the board has just seen go up: by how much, and
   *  which of the two identical animations to run — they alternate, so each
   *  rise restarts it. A first look, a new job or a correction down is not a
   *  rise, so none of them animates. */
  readonly bumps = computed(() => {
    const marks = this.marks();
    const now = this.now()?.getTime();
    const out = new Map<string, { by: number; odd: boolean }>();
    if (!now) return out;
    const line = this.line();
    for (const anchor of line.anchors) {
      for (const s of anchor.stations) {
        const mark = marks[markKey(line, s)];
        if (mark?.watched && mark.from != null && s.packed > mark.from && now - mark.at < BUMP_MS) {
          out.set(s.code, { by: s.packed - mark.from, odd: (mark.rises || 0) % 2 === 1 });
        }
      }
    }
    return out;
  });

  /** Pieces an hour, from the counts the board saw arrive, and when the box
   *  fills at that pace (epoch ms). Needs two counts a minute apart or more. */
  readonly pace = computed(() => {
    const marks = this.marks();
    const line = this.line();
    const out = new Map<string, { rate: number; eta: number | null }>();
    for (const anchor of line.anchors) {
      for (const s of anchor.stations) {
        const trail = marks[markKey(line, s)]?.trail || [];
        if (s.status !== 'running' || trail.length < 2) continue;
        const [lastAt, lastN] = trail[trail.length - 1];
        const recent = trail.filter(([t]) => t >= lastAt - PACE_WINDOW_MS);
        const [firstAt, firstN] = recent[0];
        if (recent.length < 2 || lastAt - firstAt < 60_000 || lastN <= firstN) continue;
        const perPiece = (lastAt - firstAt) / (lastN - firstN);
        const remaining = Math.max(0, s.target - s.packed);
        out.set(s.code, {
          rate: Math.round(3_600_000 / perPiece),
          eta: remaining ? lastAt + remaining * perPiece : null,
        });
      }
    }
    return out;
  });

  /** Each counting box's plan, by station code, for a part with a cycle time:
   *  from the first pieces the board saw in it, one cycle for every piece still
   *  to go — so when it should be full, and whether the count is keeping up.
   *  Rebuilt every second, like the stall timers. */
  readonly plans = computed(() => {
    const marks = this.marks();
    const now = this.now()?.getTime();
    const out = new Map<string, BoxPlan>();
    // With the server out of reach the counts on screen are stale, and a box
    // that is keeping up would be flagged as falling behind.
    if (!now || this.feed.fetchError()) return out;
    const line = this.line();
    for (const anchor of line.anchors) {
      for (const s of anchor.stations) {
        const first = marks[markKey(line, s)]?.first;
        if (s.status !== 'running' || !s.cycleSec || !first) continue;
        const cycle = s.cycleSec * 1000;
        const due = first.at + (s.target - first.n) * cycle;
        const expected = Math.min(s.target, first.n + Math.floor(Math.max(0, now - first.at) / cycle));
        // How late the next piece is, by the plan.
        const lag = now - (first.at + (s.packed + 1 - first.n) * cycle);
        const behind = lag > Math.max(PLAN_GRACE_MS, cycle);
        const overMins = Math.floor((now - due) / 60_000);
        const overdue = behind && overMins >= 1;
        out.set(s.code, {
          due,
          behind,
          overdue,
          note: overdue
            ? `Overdue ${overMins < 60 ? `${overMins} min` : span(overMins)}`
            : behind
              ? `${expected - s.packed} pcs behind`
              : 'On plan',
        });
      }
    }
    return out;
  });

  /** Boxes each machine has closed this shift, with the latest. */
  readonly boxes = computed(() => {
    const out = new Map<string, { count: number; pieces: number; last?: PartCompletion }>();
    for (const r of this.feed.completions() || []) {
      const key = boxOwner(r);
      const b = out.get(key) || { count: 0, pieces: 0 };
      // Newest first, so the first row seen for a machine is its latest box.
      out.set(key, { count: b.count + 1, pieces: b.pieces + (r.DONE_QTY || 0), last: b.last || r });
    }
    return out;
  });

  readonly boxTotals = computed(() => {
    const rows = this.feed.completions() || [];
    return {
      count: rows.length,
      pieces: rows.reduce((n, r) => n + (r.DONE_QTY || 0), 0),
      short: rows.filter((r) => !r.IS_FULL).length,
    };
  });

  /** When the board saw each machine's latest box close, timed on its own
   *  clock rather than the server's — the two need not agree. Boxes already
   *  closed when the list first loads are not news, so they are stamped 0. */
  private readonly boxSeen = linkedSignal<PartCompletion[] | null, Record<string, { id: string; at: number }> | null>({
    source: this.feed.completions,
    computation: (rows, previous) => {
      if (!rows) return null;
      const prev = previous?.value;
      const at = untracked(() => this.now()?.getTime()) ?? Date.now();
      const next: Record<string, { id: string; at: number }> = {};
      for (const r of rows) {
        const key = boxOwner(r);
        if (next[key]) continue;
        const id = r._id || r.COMPLETED_AT;
        const old = prev?.[key];
        next[key] = old && old.id === id ? old : { id, at: prev ? at : 0 };
      }
      return next;
    },
  });

  /** Machines whose box closed within CLOSED_FLASH_MS. */
  readonly justClosed = computed(() => {
    const seen = this.boxSeen();
    const now = this.now()?.getTime();
    const out = new Set<string>();
    if (!seen || !now) return out;
    for (const [key, { at }] of Object.entries(seen)) {
      if (at && now - at < CLOSED_FLASH_MS) out.add(key);
    }
    return out;
  });

  /** The latest boxes, newest first, each marked while it is news. */
  readonly recentBoxes = computed(() => {
    const seen = this.boxSeen();
    const closed = this.justClosed();
    return (this.feed.completions() || []).slice(0, FEED_ROWS).map((box) => {
      const owner = boxOwner(box);
      return { box, fresh: closed.has(owner) && seen?.[owner]?.id === (box._id || box.COMPLETED_AT) };
    });
  });

  /** What the board has seen happen, newest first: machines that stopped
   *  counting (when they crossed STALL_MS), boxes past their due time and
   *  still not full (from when they were due), machines waiting for their
   *  first piece (since the board saw the job arrive), and the boxes closed.
   *  Built from what is true now, so an alarm leaves the list once its machine
   *  counts again, and an overdue box once it closes. */
  readonly events = computed(() => {
    const marks = this.marks();
    const stalls = this.stalls();
    const plans = this.plans();
    const line = this.line();
    const out: BoardEvent[] = [];
    for (const anchor of line.anchors) {
      for (const s of anchor.stations) {
        const at = marks[markKey(line, s)]?.at;
        if (at == null) continue;
        const plan = plans.get(s.code);
        if (stalls.has(s.code)) {
          out.push({ at: at + STALL_MS, code: s.code, text: `No inspection ${STALL_MS / 60_000}+ min`, tone: 'alert' });
        } else if (plan?.overdue) {
          out.push({ at: plan.due, code: s.code, text: `Box overdue · ${s.packed}/${s.target}`, tone: 'wait' });
        } else if (s.status === 'waiting') {
          out.push({ at, code: s.code, text: 'Waiting for first piece', tone: 'wait' });
        }
      }
    }
    for (const r of this.feed.completions() || []) {
      out.push({
        at: Date.parse(r.COMPLETED_AT),
        code: boxOwner(r),
        text: r.IS_FULL ? `Box closed · ${r.DONE_QTY} pcs` : `Short box · ${r.DONE_QTY}/${r.PACKING_QTY}`,
        tone: r.IS_FULL ? 'done' : 'wait',
      });
    }
    return out.sort((a, b) => b.at - a.at).slice(0, EVENT_ROWS);
  });

  constructor() {
    const destroyRef = inject(DestroyRef);

    effect(() => writeStore(MARKS_KEY, JSON.stringify(this.marks())));
    effect(() => {
      const line = this.feed.snapshot() ? this.lineCode() : '';
      this.feed.watchCompletions(line, this.shiftFrom());
    });

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

      this.setDark(readStore(THEME_KEY) === 'dark');
      this.server.set(server);
      this.pinnedLine.set(lineCode);
      if (server) this.feed.start(server);
      else this.openSettings();
    });
  }

  // ── Theme ───────────────────────────────────────────────────────────────────

  /** The on/off switch: saved, so the TV comes back in the theme it was left in. */
  toggleTheme(): void {
    this.setDark(!this.dark());
    writeStore(THEME_KEY, this.dark() ? 'dark' : 'light');
  }

  private setDark(dark: boolean): void {
    this.dark.set(dark);
    // Paints the page behind the board to match, and lets the light board
    // show again: index.html keeps it hidden while a dark TV boots.
    document.documentElement.classList.toggle(DARK_CLASS, dark);
  }

  // ── Settings ────────────────────────────────────────────────────────────────
  // A TV has no address bar, so the server and line are chosen here with the
  // remote: the Settings button, or the Menu key.

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
