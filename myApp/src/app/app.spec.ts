import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AppComponent } from './app';
import { BoardSnapshot, QueuedProduct } from './smes-data';

describe('AppComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders a card for every station on the line', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelectorAll('.pl-anchor').length).toBe(2);
    expect(compiled.querySelectorAll('.pl-card').length).toBe(8);
  });

  it('derives the anchor and line totals from the stations', () => {
    const app = TestBed.createComponent(AppComponent).componentInstance;
    const [a, b] = app.anchors();

    expect([a.packed, a.target, a.pct]).toEqual([696, 1010, 69]);
    expect([b.packed, b.target, b.pct]).toEqual([869, 1390, 63]);
    expect(a.range).toBe('WS-01 – WS-04');

    const totals = app.totals();
    expect([totals.packed, totals.target, totals.pct]).toEqual([1565, 2400, 65]);
  });
});

describe('stall timer', () => {
  const MIN = 60_000;
  const T0 = new Date(2026, 8, 26, 10, 0, 0).getTime();

  /** M-01 runs once it has a count; M-02 has its job queued but has not started. */
  function snapshot(m01Packed: number, m01Part = 'KL-1'): BoardSnapshot {
    const product = (part: string, done: number): QueuedProduct => ({
      PRODUCT_NAME: 'Pump',
      CUSTOMER_NAME: 'Indoshell',
      WORKER_NO: 'W1',
      PARTS: [{ PART_NAME: part, PACKING_QTY: 56, DONE_QTY: done, IS_DONE: false }],
    });
    return {
      lines: [
        {
          LINE_CODE: 'L1',
          LINE_NAME: 'Line 1',
          IS_ACTIVE: true,
          MACHINES: [
            { MACHINE_CODE: 'M-01', MACHINE_NAME: 'M-01', ANCHOR_NO: 1, CELL_NO: 1 },
            { MACHINE_CODE: 'M-02', MACHINE_NAME: 'M-02', ANCHOR_NO: 1, CELL_NO: 2 },
          ],
        },
      ],
      boards: [
        {
          LINE_CODE: 'L1',
          ANCHORS: [
            {
              ANCHOR_NO: 1,
              CELLS: [
                { CELL_NO: 1, QUEUE: [product(m01Part, m01Packed)] },
                { CELL_NO: 2, QUEUE: [product('KL-2', 0)] },
              ],
            },
          ],
        },
      ],
      shifts: [],
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

  /** What the board flags with its clock at `ms`. */
  function stallsAt(ms: number): Map<string, string> {
    app.now.set(new Date(ms));
    return app.stalls();
  }

  beforeEach(() => {
    localStorage.clear();
    boot();
  });

  it('leaves a running station alone for the first ten minutes', () => {
    land(snapshot(4), T0);
    expect(stallsAt(T0 + 10 * MIN - 1000).size).toBe(0);
  });

  it('times a running station from its last count once ten minutes pass', () => {
    land(snapshot(4), T0);
    expect(stallsAt(T0 + 10 * MIN).get('M-01')).toBe('10:00');
    expect(stallsAt(T0 + 72 * MIN + 5000).get('M-01')).toBe('1:12:05');
  });

  it('never times a station that has not started counting', () => {
    land(snapshot(4), T0);
    expect(stallsAt(T0 + 30 * MIN).has('M-02')).toBe(false);
  });

  it('restarts the timer on a new count, but not on a poll that brings none', () => {
    land(snapshot(4), T0);
    expect(stallsAt(T0 + 11 * MIN).has('M-01')).toBe(true);

    land(snapshot(4), T0 + 11 * MIN + 30_000);
    expect(stallsAt(T0 + 12 * MIN).get('M-01')).toBe('12:00');

    land(snapshot(5), T0 + 12 * MIN);
    expect(stallsAt(T0 + 12 * MIN).has('M-01')).toBe(false);
    expect(stallsAt(T0 + 22 * MIN).get('M-01')).toBe('10:00');
  });

  it('restarts the timer when the station moves on to another job', () => {
    land(snapshot(4), T0);
    stallsAt(T0 + 5 * MIN);

    land(snapshot(4, 'KL-9'), T0 + 5 * MIN);
    expect(stallsAt(T0 + 14 * MIN).has('M-01')).toBe(false);
    expect(stallsAt(T0 + 15 * MIN).get('M-01')).toBe('10:00');
  });

  it('flags nothing while the server is out of reach', () => {
    land(snapshot(4), T0);
    app.feed.fetchError.set(true);
    expect(stallsAt(T0 + 30 * MIN).size).toBe(0);
  });

  it('picks the timers up again after a reboot', () => {
    land(snapshot(4), T0);
    stallsAt(T0 + MIN);
    TestBed.tick();

    // A fresh board, as after a power cycle, finding the count unchanged.
    TestBed.resetTestingModule();
    boot();
    land(snapshot(4), T0 + 30 * MIN);
    expect(stallsAt(T0 + 30 * MIN).get('M-01')).toBe('30:00');
  });

  it('draws the red frame and the timer on the stalled card only', async () => {
    land(snapshot(4), T0);
    await fixture.whenStable();
    // The first render starts the real clock; wind it to where the test needs it.
    app.now.set(new Date(T0 + 10 * MIN));
    fixture.detectChanges();

    const card = (code: string) =>
      Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.pl-card')).find(
        (c) => c.querySelector('.pl-ws')?.textContent === code,
      )!;
    expect(card('M-01').classList).toContain('pl-stalled');
    expect(card('M-01').querySelector('.pl-stall-v')?.textContent).toBe('10:00');
    expect(card('M-02').classList).not.toContain('pl-stalled');
    expect(card('M-02').querySelector('.pl-stall')).toBeNull();
  });
});
