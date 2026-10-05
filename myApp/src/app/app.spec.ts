import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AppComponent } from './app';
import { BoardSnapshot, PartCompletion, ProductPacking, QueuedPart, QueuedProduct, SmesShift } from './smes-data';

const MIN = 60_000;
const T0 = new Date(2026, 8, 26, 10, 0, 0).getTime();

/** Line L1: M-01..M-04 on anchor 1, M-05..M-08 on anchor 2, cells 1–4 each. */
const MACHINES = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
  MACHINE_CODE: `M-0${n}`,
  MACHINE_NAME: `Machine ${n}`,
  ANCHOR_NO: n <= 4 ? 1 : 2,
  CELL_NO: ((n - 1) % 4) + 1,
}));

function part(no: string, done: number, qty = 56, comp = ''): QueuedPart {
  return { PART_NAME: no, COMP_NAME: comp, PACKING_QTY: qty, DONE_QTY: done, IS_DONE: done >= qty };
}

/** A queue entry for product `name`, which is also its id in the master. */
function product(name: string, parts: QueuedPart[], entryId?: string): QueuedProduct {
  return {
    _id: entryId,
    PRODUCT_ID: name,
    PRODUCT_NAME: name,
    CUSTOMER_NAME: 'Indoshell',
    WORKER_NO: 'W1',
    WORKER_NAME: 'Ravi',
    PARTS: parts,
  };
}

/** Product `id` in the master, with these cycle times in seconds by part number. */
function master(id: string, cycles: Record<string, number | null>): ProductPacking {
  return { _id: id, PARTS: Object.entries(cycles).map(([no, sec]) => ({ PART_NAME: no, CYCLE_TIME_SEC: sec })) };
}

/** The line with these queues, by machine code; every other cell is empty. */
function snapshot(
  queues: Record<string, QueuedProduct[]> = {},
  shifts: SmesShift[] = [],
  products: ProductPacking[] = [],
): BoardSnapshot {
  return {
    lines: [{ LINE_CODE: 'L1', LINE_NAME: 'Line 1', IS_ACTIVE: true, MACHINES }],
    boards: [
      {
        LINE_CODE: 'L1',
        ANCHORS: [1, 2].map((anchorNo) => ({
          ANCHOR_NO: anchorNo,
          CELLS: MACHINES.filter((m) => m.ANCHOR_NO === anchorNo).map((m) => ({
            CELL_NO: m.CELL_NO,
            QUEUE: queues[m.MACHINE_CODE] || [],
          })),
        })),
      },
    ],
    shifts,
    products,
  };
}

/** M-01 runs once it has a count; M-02 has its job queued but has not started. */
function pair(m01Packed: number, m01Part = 'KL-1'): BoardSnapshot {
  return snapshot({
    'M-01': [product('Pump', [part(m01Part, m01Packed)])],
    'M-02': [product('Pump', [part('KL-2', 0)])],
  });
}

/** M-01 packing a part that takes `cycleSec` a piece, `packed` in its box of
 *  56; M-02 counting a part the master has no cycle time for. */
function timed(packed: number, cycleSec = 30): BoardSnapshot {
  return snapshot(
    {
      'M-01': [product('Pump', [part('KL-1', packed)])],
      'M-02': [product('Valve', [part('V-1', 3)])],
    },
    [],
    [master('Pump', { 'KL-1': cycleSec })],
  );
}

function box(machine: string, closedAt: number, id: string, done = 56, qty = 56): PartCompletion {
  return {
    _id: id,
    COMPLETED_AT: new Date(closedAt).toISOString(),
    LINE_CODE: 'L1',
    ANCHOR_NO: 1,
    CELL_NO: 1,
    MACHINE_CODE: machine,
    PART_NAME: 'KL-1',
    PACKING_QTY: qty,
    DONE_QTY: done,
    SHORT_BY: qty - done,
    IS_FULL: done >= qty,
  };
}

let fixture: ComponentFixture<AppComponent>;
let app: AppComponent;

function boot(): void {
  TestBed.configureTestingModule({ imports: [AppComponent] });
  fixture = TestBed.createComponent(AppComponent);
  app = fixture.componentInstance;
}

/** A fetch landing at `ms`. */
function land(snap: BoardSnapshot, ms: number): void {
  app.feed.snapshot.set(snap);
  app.feed.updatedAt.set(new Date(ms));
}

function at(ms: number): void {
  app.now.set(new Date(ms));
}

/** What the board flags with its clock at `ms` — reading it, as the screen does every second. */
function stallsAt(ms: number): Map<string, string> {
  at(ms);
  return app.stalls();
}

/** A fetch landing at `ms`, and the board looking at it then. */
function observe(snap: BoardSnapshot, ms: number): void {
  land(snap, ms);
  stallsAt(ms);
}

function cardOf(code: string): Element {
  return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.pl-card')).find(
    (c) => c.querySelector('.pl-mc')?.textContent === code,
  )!;
}

beforeEach(() => {
  localStorage.clear();
  boot();
});

describe('AppComponent', () => {
  it('should create the app', () => {
    expect(app).toBeTruthy();
  });

  it('renders a card for every machine on the line, across the two anchors', async () => {
    land(snapshot(), T0);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelectorAll('.pl-anchor').length).toBe(2);
    expect(el.querySelectorAll('.pl-card').length).toBe(8);
  });

  it('derives the anchor and line totals from the stations', () => {
    land(
      snapshot({
        'M-01': [product('Pump', [part('A', 10, 56)])],
        'M-02': [product('Pump', [part('B', 4, 10)])],
        'M-07': [product('Pump', [part('C', 6, 56)])],
      }),
      T0,
    );
    const [a, b] = app.anchors();

    expect([a.packed, a.target, a.pct]).toEqual([14, 66, 21]);
    expect([b.packed, b.target, b.pct]).toEqual([6, 56, 11]);
    expect(a.range).toBe('M-01 – M-04');

    const totals = app.totals();
    expect([totals.packed, totals.target, totals.pct]).toEqual([20, 122, 16]);
  });
});

describe('machine card', () => {
  it('names the part in hand, the rest of its product, and what is queued behind', () => {
    land(
      snapshot({
        'M-01': [
          product('Pump', [part('P-1', 56), part('P-2', 3, 20, 'Housing'), part('P-3', 0, 30, 'Cover')]),
          product('Valve', [part('V-1', 0)]),
          product('Gear', [part('G-1', 0)]),
          product('Shaft', [part('S-1', 0)]),
        ],
      }),
      T0,
    );
    const s = app.anchors()[0].stations[0];

    expect(s.status).toBe('running');
    expect([s.partNo, s.partName, s.partStep, s.partCount]).toEqual(['P-2', 'Housing', 2, 3]);
    expect([s.packed, s.target, s.remaining]).toEqual([3, 20, 17]);
    // Next is the product's own next part — its third — so no product is named for it.
    expect([s.nextPartNo, s.nextPartName, s.nextQty, s.nextStep, s.nextProduct]).toEqual(['P-3', 'Cover', 30, 3, '']);
    expect(s.queued).toBe(3);
  });

  it("on a product's last part, makes next the first part of the product queued behind, and names it", () => {
    land(
      snapshot({
        'M-01': [
          product('Pump', [part('P-1', 3)]),
          product('Valve', [part('V-1', 0, 40, 'Valve housing'), part('V-2', 0)]),
          product('Gear', [part('G-1', 0)]),
        ],
        'M-02': [product('Pump', [part('P-9', 3)])],
      }),
      T0,
    );
    const [s, last] = app.anchors()[0].stations;

    expect([s.nextPartNo, s.nextPartName, s.nextQty, s.nextStep, s.nextProduct]).toEqual(['V-1', 'Valve housing', 40, 0, 'Valve']);
    expect(s.queued).toBe(1);
    expect([last.nextPartNo, last.queued]).toEqual(['', 0]);
  });

  it('points at the next box near the end of this one: five pieces of 56, two of 10', () => {
    land(
      snapshot({
        'M-01': [product('Pump', [part('P-1', 51)])],
        'M-02': [product('Pump', [part('P-2', 50)])],
        'M-03': [product('Pump', [part('P-3', 8, 10)])],
        'M-04': [product('Pump', [part('P-4', 5, 10)])],
      }),
      T0,
    );
    const [five, six, twoOfTen, fiveOfTen] = app.anchors()[0].stations;

    expect(five.nearFull).toBe(true);
    expect(six.nearFull).toBe(false);
    expect(twoOfTen.nearFull).toBe(true);
    expect(fiveOfTen.nearFull).toBe(false);
  });

  it('runs the next part across its strip, and says still when there is none', async () => {
    land(
      snapshot({
        'M-01': [product('Pump', [part('P-1', 3, 56, 'Housing'), part('P-2', 0, 30, 'Cover')])],
        'M-02': [product('Pump', [part('P-9', 3)])],
      }),
      T0,
    );
    await fixture.whenStable();

    const run = cardOf('M-01').querySelectorAll('.pl-ticker-run > *');
    expect(Array.from(run, (e) => e.textContent?.trim())).toEqual(['Cover', 'P-2', 'Qty 30', 'Part 2/2']);
    expect(cardOf('M-02').querySelector('.pl-ticker')).toBeNull();
    expect(cardOf('M-02').querySelector('.pl-next-none')?.textContent).toBe('Last part in the queue');
  });

  it("reads each part's cycle time off the product master, matching parts as the main UI does", () => {
    land(
      snapshot(
        {
          'M-01': [product('Pump', [part('P-1', 3)])],
          // Queued before parts had numbers: its number field holds the component name.
          'M-02': [product('Pump', [part('Housing', 3)])],
          'M-03': [product('Valve', [part('V-1', 3)])],
        },
        [],
        [
          {
            _id: 'Pump',
            PARTS: [
              { PART_NAME: 'P-1', CYCLE_TIME_SEC: 30 },
              { PART_NAME: 'P-2', COMP_NAME: 'Housing', CYCLE_TIME_SEC: 45 },
            ],
          },
        ],
      ),
      T0,
    );
    const [m1, m2, m3] = app.anchors()[0].stations;

    expect([m1.cycleSec, m2.cycleSec, m3.cycleSec]).toEqual([30, 45, 0]);
  });
});

describe('component name', () => {
  /** jsdom lays nothing out, so the name box is this wide and each letter 10. */
  let room = 120;

  beforeEach(() => {
    room = 120;
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
      return this.classList.contains('pl-name') ? room : 0;
    });
    vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockImplementation(function (this: Element) {
      return this.classList.contains('pl-name') ? (this.textContent || '').length * 10 : 0;
    });
  });

  afterEach(() => vi.restoreAllMocks());

  function fitOf(code: string): string {
    return (cardOf(code).querySelector('.pl-name') as HTMLElement).style.getPropertyValue('--fit');
  }

  it('sets a name too long for its box smaller to keep it on one line, but only so far', async () => {
    land(
      snapshot({
        'M-01': [product('Pump', [part('P-1', 3, 56, 'Piston pin')])],
        'M-02': [product('Pump', [part('P-2', 3, 56, 'Caliper Bracket')])],
        'M-03': [product('Pump', [part('P-3', 3, 56, 'Valve housing assembly, front left hand side')])],
      }),
      T0,
    );
    await fixture.whenStable();

    expect(fitOf('M-01')).toBe('');
    expect(+fitOf('M-02')).toBeCloseTo((0.98 * 120) / 150);
    expect(fitOf('M-03')).toBe('0.6');
  });

  it('measures the name again when the window changes size', async () => {
    land(snapshot({ 'M-01': [product('Pump', [part('P-1', 3, 56, 'Caliper Bracket')])] }), T0);
    await fixture.whenStable();
    expect(fitOf('M-01')).not.toBe('');

    room = 200;
    window.dispatchEvent(new Event('resize'));
    await fixture.whenStable();

    expect(fitOf('M-01')).toBe('');
  });
});

describe('stall timer', () => {
  it('leaves a running station alone for the first ten minutes', () => {
    land(pair(4), T0);
    expect(stallsAt(T0 + 10 * MIN - 1000).size).toBe(0);
  });

  it('times a running station from its last count once ten minutes pass', () => {
    land(pair(4), T0);
    expect(stallsAt(T0 + 10 * MIN).get('M-01')).toBe('10:00');
    expect(stallsAt(T0 + 72 * MIN + 5000).get('M-01')).toBe('1:12:05');
  });

  it('never times a station that has not started counting', () => {
    land(pair(4), T0);
    expect(stallsAt(T0 + 30 * MIN).has('M-02')).toBe(false);
  });

  it('restarts the timer on a new count, but not on a poll that brings none', () => {
    land(pair(4), T0);
    expect(stallsAt(T0 + 11 * MIN).has('M-01')).toBe(true);

    land(pair(4), T0 + 11 * MIN + 30_000);
    expect(stallsAt(T0 + 12 * MIN).get('M-01')).toBe('12:00');

    land(pair(5), T0 + 12 * MIN);
    expect(stallsAt(T0 + 12 * MIN).has('M-01')).toBe(false);
    expect(stallsAt(T0 + 22 * MIN).get('M-01')).toBe('10:00');
  });

  it('restarts the timer when the station moves on to another job', () => {
    observe(pair(4), T0);
    land(pair(4, 'KL-9'), T0 + 5 * MIN);

    expect(stallsAt(T0 + 14 * MIN).has('M-01')).toBe(false);
    expect(stallsAt(T0 + 15 * MIN).get('M-01')).toBe('10:00');
  });

  it('flags nothing while the server is out of reach', () => {
    land(pair(4), T0);
    app.feed.fetchError.set(true);
    expect(stallsAt(T0 + 30 * MIN).size).toBe(0);
  });

  it('picks the timers up again after a reboot', () => {
    observe(pair(4), T0 + MIN);
    TestBed.tick();

    // A fresh board, as after a power cycle, finding the count unchanged.
    TestBed.resetTestingModule();
    boot();
    land(pair(4), T0 + 30 * MIN);
    expect(stallsAt(T0 + 30 * MIN).get('M-01')).toBe('29:00');
  });

  it('draws the red frame and the timer on the stalled card only', async () => {
    land(pair(4), T0);
    await fixture.whenStable();
    // The first render starts the real clock; wind it to where the test needs it.
    at(T0 + 10 * MIN);
    fixture.detectChanges();

    expect(cardOf('M-01').classList).toContain('pl-stalled');
    expect(cardOf('M-01').querySelector('.pl-stall-v')?.textContent).toBe('10:00');
    expect(cardOf('M-02').classList).not.toContain('pl-stalled');
    expect(cardOf('M-02').querySelector('.pl-stall')).toBeNull();
  });
});

describe('pace', () => {
  it('reads the pace from the counts it saw arrive, and when the box fills at it', () => {
    observe(pair(4), T0);
    observe(pair(5), T0 + 2 * MIN);
    expect(app.pace().has('M-01')).toBe(false);

    observe(pair(7), T0 + 6 * MIN);
    // Two pieces in four minutes: 30 an hour, and 49 left at two minutes each.
    expect(app.pace().get('M-01')).toEqual({ rate: 30, eta: T0 + 6 * MIN + 49 * 2 * MIN });
  });

  it('says how long ago the last piece came only once it has seen one come', () => {
    observe(pair(4), T0);
    at(T0 + 3 * MIN);
    expect(app.lastPiece().has('M-01')).toBe(false);

    observe(pair(5), T0 + 4 * MIN);
    at(T0 + 4 * MIN + 20_000);
    expect(app.lastPiece().get('M-01')).toBe('just now');
    at(T0 + 7 * MIN);
    expect(app.lastPiece().get('M-01')).toBe('3 min ago');
  });
});

describe('box plan', () => {
  /** M-01's first piece landing at T0, after the board saw its box empty. */
  function firstPieceAtT0(cycleSec = 30): void {
    observe(timed(0, cycleSec), T0 - MIN);
    observe(timed(1, cycleSec), T0);
  }

  it('plans the box from its first piece: one cycle time for every piece after it', () => {
    firstPieceAtT0();

    // 55 pieces to go after the first, at 30 s each.
    expect(app.plans().get('M-01')).toEqual({ due: T0 + 55 * 30_000, behind: false, overdue: false, note: 'On plan' });
    expect(app.plans().has('M-02')).toBe(false);
  });

  it('stays on plan while the count keeps up, and says how far behind once it is over a minute behind', () => {
    firstPieceAtT0();
    observe(timed(11), T0 + 5 * MIN);
    expect(app.plans().get('M-01')?.note).toBe('On plan');

    // The 12th piece was due at 5:30 — a minute ago, which is still allowed.
    at(T0 + 6 * MIN + 30_000);
    expect(app.plans().get('M-01')?.note).toBe('On plan');

    at(T0 + 6 * MIN + 31_000);
    expect(app.plans().get('M-01')).toEqual(expect.objectContaining({ behind: true, overdue: false, note: '3 pcs behind' }));
  });

  it("allows a slow part one whole cycle's lateness before it says so", () => {
    firstPieceAtT0(120);

    // The second piece was due at 2:00.
    at(T0 + 3 * MIN + 30_000);
    expect(app.plans().get('M-01')?.behind).toBe(false);

    at(T0 + 4 * MIN + 1000);
    expect(app.plans().get('M-01')?.note).toBe('2 pcs behind');
  });

  it('says overdue once the due time is a minute gone, and lists the box among the events', () => {
    firstPieceAtT0();
    observe(timed(40), T0 + 20 * MIN);

    // Due at 27:30, and still 16 short.
    at(T0 + 29 * MIN);
    const m01 = () => app.events().filter((e) => e.code === 'M-01');
    expect(app.plans().get('M-01')).toEqual(expect.objectContaining({ behind: true, overdue: true, note: 'Overdue 1 min' }));
    expect(m01().map((e) => [e.at, e.text, e.tone])).toEqual([[T0 + 55 * 30_000, 'Box overdue · 40/56', 'wait']]);

    // Stopped altogether: the stall is what the list says.
    at(T0 + 102 * MIN + 30_000);
    expect(app.plans().get('M-01')?.note).toBe('Overdue 1h 15m');
    expect(m01().map((e) => e.text)).toEqual(['No inspection 10+ min']);
  });

  it('plans a box that was already under way from when the board first saw it', () => {
    observe(timed(20), T0);

    expect(app.plans().get('M-01')?.due).toBe(T0 + 36 * 30_000);
  });

  it('starts afresh on the next box of the same part', () => {
    const twice = (a: number, b: number) =>
      snapshot(
        { 'M-01': [product('Pump', [part('KL-1', a)], 'q1'), product('Pump', [part('KL-1', b)], 'q2')] },
        [],
        [master('Pump', { 'KL-1': 30 })],
      );
    observe(twice(55, 0), T0);
    // The box fills, and the next one's first pieces land before the board looks again.
    observe(twice(56, 2), T0 + 2 * MIN);

    expect(app.plans().get('M-01')?.due).toBe(T0 + 2 * MIN + 54 * 30_000);
  });

  it('plans nothing without a cycle time, before the first piece, or while the server is out of reach', () => {
    land(
      snapshot(
        {
          'M-01': [product('Pump', [part('KL-1', 0)])],
          'M-02': [product('Valve', [part('V-1', 3)])],
          'M-03': [product('Gear', [part('G-1', 5)])],
        },
        [],
        [master('Pump', { 'KL-1': 30 }), master('Gear', { 'G-1': null })],
      ),
      T0,
    );
    at(T0 + MIN);
    expect(app.plans().size).toBe(0);

    firstPieceAtT0();
    expect(app.plans().size).toBe(1);
    app.feed.fetchError.set(true);
    expect(app.plans().size).toBe(0);
  });

  it('keeps counting from the same first piece after a reboot', () => {
    firstPieceAtT0();
    TestBed.tick();

    TestBed.resetTestingModule();
    boot();
    observe(timed(5), T0 + 3 * MIN);
    expect(app.plans().get('M-01')?.due).toBe(T0 + 55 * 30_000);
  });

  it('puts the due time on the card, and turns the frame amber once the box falls behind', async () => {
    land(timed(1), T0);
    await fixture.whenStable();
    at(T0);
    fixture.detectChanges();

    const plan = cardOf('M-01').querySelector('.pl-plan')!;
    expect(plan.querySelector('.pl-fact-v')?.textContent).toBe('10:27 AM');
    expect(plan.querySelector('.pl-plan-note')?.textContent).toBe('On plan');
    expect(cardOf('M-01').classList).not.toContain('pl-behind');
    expect(cardOf('M-02').querySelector('.pl-plan')).toBeNull();

    at(T0 + 5 * MIN);
    fixture.detectChanges();
    expect(cardOf('M-01').classList).toContain('pl-behind');
    expect(cardOf('M-01').querySelector('.pl-plan-note')?.textContent).toBe('10 pcs behind');
  });
});

describe('count animation', () => {
  it('marks a count it saw go up, by how much, for a moment', () => {
    observe(pair(4), T0);
    expect(app.bumps().size).toBe(0);

    // Three pieces landing in one fetch.
    observe(pair(7), T0 + MIN);
    expect(app.bumps().get('M-01')?.by).toBe(3);

    at(T0 + MIN + 3000);
    expect(app.bumps().size).toBe(0);
  });

  it('alternates the animation on every rise, so each one plays afresh', () => {
    observe(pair(4), T0);
    observe(pair(5), T0 + MIN);
    const first = app.bumps().get('M-01')?.odd;
    observe(pair(6), T0 + MIN + 1000);

    expect(app.bumps().get('M-01')?.odd).toBe(!first);
  });

  it('does not animate a correction down, or a new part starting', () => {
    observe(pair(5), T0);
    observe(pair(4), T0 + MIN);
    expect(app.bumps().size).toBe(0);

    observe(pair(1, 'KL-9'), T0 + 2 * MIN);
    expect(app.bumps().size).toBe(0);
  });

  it('pops the number and floats the rise on the card', async () => {
    land(pair(4), T0);
    await fixture.whenStable();
    at(T0);
    fixture.detectChanges();

    land(pair(5), T0 + MIN);
    at(T0 + MIN);
    fixture.detectChanges();

    const count = cardOf('M-01').querySelector('.pl-gauge-n')!;
    expect(count.matches('.pl-bump, .pl-bump-alt')).toBe(true);
    expect(cardOf('M-01').querySelector('.pl-plus')?.textContent?.trim()).toBe('+1');
    expect(cardOf('M-02').querySelector('.pl-plus')).toBeNull();
    expect(cardOf('M-02').querySelector('.pl-gauge-n')!.matches('.pl-bump, .pl-bump-alt')).toBe(false);
  });
});

describe('boxes this shift', () => {
  it("counts each machine's boxes, and the line's", () => {
    app.feed.completions.set([box('M-01', T0, 'b3'), box('M-01', T0 - 30 * MIN, 'b2', 50), box('M-07', T0 - 60 * MIN, 'b1')]);

    expect(app.boxes().get('M-01')).toEqual({ count: 2, pieces: 106 });
    expect(app.boxTotals()).toEqual({ count: 3, pieces: 162, short: 1 });
  });

  it('calls out a box it saw close, but not the ones closed before it looked', () => {
    at(T0);
    app.feed.completions.set([box('M-07', T0 - 60 * MIN, 'b1')]);
    expect(app.justClosed().size).toBe(0);

    app.feed.completions.set([box('M-01', T0, 'b2'), box('M-07', T0 - 60 * MIN, 'b1')]);
    expect([...app.justClosed()]).toEqual(['M-01']);

    at(T0 + 91_000);
    expect(app.justClosed().size).toBe(0);
  });

  it('lists the latest boxes newest first, marking the one that just closed', () => {
    at(T0);
    app.feed.completions.set([box('M-07', T0 - 60 * MIN, 'b1')]);
    app.recentBoxes();
    app.feed.completions.set([box('M-01', T0, 'b2'), box('M-07', T0 - 60 * MIN, 'b1')]);

    expect(app.recentBoxes().map((r) => [r.box._id, r.fresh])).toEqual([
      ['b2', true],
      ['b1', false],
    ]);
  });

  describe('as a box arrives', () => {
    const animate = vi.fn();

    beforeEach(() => {
      animate.mockClear();
      // jsdom animates nothing and lays nothing out: animate() is recorded, and
      // each box sits 70 px below the one before it, all in the one column.
      Object.defineProperty(HTMLElement.prototype, 'animate', { value: animate, configurable: true, writable: true });
      vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('pl-box') ? Array.from(this.parentElement!.children).indexOf(this) * 70 : 0;
      });
    });

    afterEach(() => {
      delete (HTMLElement.prototype as { animate?: unknown }).animate;
      vi.restoreAllMocks();
    });

    /** The list loads with one old box, then M-01 closes one. */
    async function arrive(): Promise<void> {
      land(pair(4), T0);
      await fixture.whenStable();
      at(T0);
      await fixture.whenStable();
      app.feed.completions.set([box('M-07', T0 - 60 * MIN, 'b1')]);
      await fixture.whenStable();
      // The list as it first loads is not news, and moves nothing.
      expect(animate).not.toHaveBeenCalled();

      app.feed.completions.set([box('M-01', T0, 'b2'), box('M-07', T0 - 60 * MIN, 'b1')]);
      await fixture.whenStable();
    }

    it('slides the list down, bringing the new box in from above, lit', async () => {
      await arrive();

      const rows = (fixture.nativeElement as HTMLElement).querySelectorAll('.pl-box');
      const push = [{ transform: 'translateY(-70px)' }, { transform: 'none' }];
      expect(animate.mock.calls.map(([frames]) => frames)).toEqual([push, push]);
      expect(animate.mock.contexts).toEqual([rows[0], rows[1]]);
      expect(rows[0].classList).toContain('pl-box-new');
      expect(rows[1].classList).not.toContain('pl-box-new');
    });

    it('moves nothing for a viewer who has asked for less motion', async () => {
      const original = window.matchMedia;
      window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
      try {
        await arrive();
        expect(animate).not.toHaveBeenCalled();
      } finally {
        window.matchMedia = original;
      }
    });
  });

  it('moves the card straight on to the next part when a box closes, and calls the box out only in the list', async () => {
    land(pair(55), T0);
    await fixture.whenStable();
    at(T0);
    await fixture.whenStable();
    // The list as it first loads: nothing closed yet this shift.
    app.feed.completions.set([]);
    fixture.detectChanges();

    // M-01's box fills, and its next part is on the machine awaiting the first piece.
    land(pair(0, 'KL-9'), T0 + MIN);
    at(T0 + MIN);
    app.feed.completions.set([box('M-01', T0 + MIN, 'b1')]);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.pl-box-new .pl-box-mc')?.textContent).toBe('M-01');
    expect(cardOf('M-01').querySelector('.pl-waiting')).not.toBeNull();
    expect(cardOf('M-01').textContent).not.toContain('Box closed');
  });

  it('counts from the start of the shift, which for an overnight one was yesterday', () => {
    land(snapshot({}, [{ SHIFT_CODE: 'C', FROM_TIME: '10:00:00 PM', TO_TIME: '06:00:00 AM' }]), T0);
    at(new Date(2026, 8, 26, 2, 30).getTime());

    expect(app.shiftFrom()).toBe(new Date(2026, 8, 25, 22, 0).toISOString());
    expect(app.shiftClock()).toEqual({ pct: 56, left: '3h 30m' });
  });
});

describe('dark theme', () => {
  function darkCardOf(code: string): Element {
    return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.dk-card')).find(
      (c) => c.querySelector('.dk-mc')?.textContent === code,
    )!;
  }

  /** A board switched on with the dark theme saved, as after a reboot. */
  function bootDark(): void {
    TestBed.resetTestingModule();
    localStorage.setItem('tvTheme', 'dark');
    boot();
  }

  afterEach(() => document.documentElement.classList.remove('tv-dark'));

  it('switches between the light and the dark board on its on/off button, and saves the choice', async () => {
    land(pair(4), T0);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.dk-card')).toBeNull();

    (el.querySelector('.pl-theme') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(el.querySelectorAll('.dk-card').length).toBe(8);
    expect(el.querySelector('.pl-card')).toBeNull();
    expect(localStorage.getItem('tvTheme')).toBe('dark');
    expect(document.documentElement.classList).toContain('tv-dark');

    (el.querySelector('.dk-theme') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(el.querySelectorAll('.pl-card').length).toBe(8);
    expect(localStorage.getItem('tvTheme')).toBe('light');
    expect(document.documentElement.classList).not.toContain('tv-dark');
  });

  it('comes back in the theme it was left in', async () => {
    bootDark();
    land(pair(4), T0);
    await fixture.whenStable();

    expect(app.dark()).toBe(true);
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.dk-card').length).toBe(8);
  });

  it('flags the same machines as the light board: the stalled one red with its timer', async () => {
    bootDark();
    land(pair(4), T0);
    await fixture.whenStable();
    at(T0 + 10 * MIN);
    fixture.detectChanges();

    expect(darkCardOf('M-01').classList).toContain('dk-stalled');
    expect(darkCardOf('M-01').querySelector('.dk-stall .dk-flag-v')?.textContent).toBe('10:00');
    expect(darkCardOf('M-02').classList).not.toContain('dk-stalled');
    expect(darkCardOf('M-02').querySelector('.dk-waiting')).not.toBeNull();
  });

  it('runs the next part across the strip, as the light board does', async () => {
    bootDark();
    land(snapshot({ 'M-01': [product('Pump', [part('P-1', 3, 56, 'Housing'), part('P-2', 0, 30, 'Cover')])] }), T0);
    await fixture.whenStable();

    const run = darkCardOf('M-01').querySelectorAll('.pl-ticker-run > *');
    expect(Array.from(run, (e) => e.textContent?.trim())).toEqual(['Cover', 'P-2', 'Qty 30', 'Part 2/2']);
  });

  it('puts the box plan on the dark card too, amber once the box falls behind', async () => {
    bootDark();
    land(timed(1), T0);
    await fixture.whenStable();
    at(T0 + 5 * MIN);
    fixture.detectChanges();

    expect(darkCardOf('M-01').classList).toContain('dk-behind');
    expect(darkCardOf('M-01').querySelector('.dk-plan .dk-fact-v')?.textContent).toBe('10:27 AM');
    expect(darkCardOf('M-01').querySelector('.dk-plan-note')?.textContent).toBe('10 pcs behind');
    expect(darkCardOf('M-02').querySelector('.dk-plan')).toBeNull();
  });
});

describe('recent events', () => {
  it('lists what it saw happen, newest first: stalls, first pieces awaited, and boxes closed', () => {
    land(pair(4), T0);
    app.feed.completions.set([box('M-03', T0 + 2 * MIN, 'b2', 8, 10), box('M-07', T0 - 30 * MIN, 'b1')]);
    at(T0 + 15 * MIN);

    expect(app.events().map((e) => [e.at, e.code, e.text, e.tone])).toEqual([
      [T0 + 10 * MIN, 'M-01', 'No inspection 10+ min', 'alert'],
      [T0 + 2 * MIN, 'M-03', 'Short box · 8/10', 'wait'],
      [T0, 'M-02', 'Waiting for first piece', 'wait'],
      [T0 - 30 * MIN, 'M-07', 'Box closed · 56 pcs', 'done'],
    ]);
  });

  it('shows them on the light board as well as the dark', async () => {
    land(pair(4), T0);
    await fixture.whenStable();
    at(T0 + 15 * MIN);
    fixture.detectChanges();

    const rows = (fixture.nativeElement as HTMLElement).querySelectorAll('.pl-event');
    expect(Array.from(rows, (r) => [r.getAttribute('data-tone'), r.querySelector('.pl-event-mc')?.textContent])).toEqual([
      ['alert', 'M-01'],
      ['wait', 'M-02'],
    ]);
  });
});
