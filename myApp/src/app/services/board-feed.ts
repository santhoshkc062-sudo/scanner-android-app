import { HttpClient } from '@angular/common/http';
import { Injectable, NgZone, inject, signal } from '@angular/core';
import { Subject, Subscription, asyncScheduler, catchError, forkJoin, interval, map, merge, of, startWith, switchMap, throttleTime } from 'rxjs';
// Type only — the client itself is imported lazily in start().
import type io from 'socket.io-client';

import { AnchorMapping, BoardSnapshot, PartCompletion, ProductPacking, SmesLine, SmesShift } from '../smes-data';

/** Where the server address lives — the same key the scanner screen uses. */
export const SERVER_KEY = 'serverIp';
/** Which line this TV is pinned to, so it survives a power cycle. */
export const LINE_KEY = 'tvLineCode';

/** The event the server emits after any write that changes the board —
 *  AnchorMappingController, LineController and the MQTT box counter. */
const BOARD_EVENT = 'anchorMappingUpdate';
/** Emitted the moment a box closes, with the line it closed on. */
const COMPLETED_EVENT = 'partCompleted';
/** More boxes than one line closes in a shift. */
const COMPLETIONS_PAGE = 500;
/** Safety net for a dropped socket. The push is the real trigger. */
const POLL_MS = 30_000;
/** One MQTT frame can carry several machines, each nudging the board. The
 *  first push fetches at once; the rest of the burst folds into one trailing
 *  fetch at the end of this window. */
const PUSH_THROTTLE_MS = 150;

/** What a refetch has to cover. The server's push says `board` when only a
 *  cell queue changed, which needs just /anchor-mapping — the lines, shifts
 *  and products are unchanged, and skipping them is most of the round-trip. */
type Scope = 'board' | 'all';

export type FeedStatus = 'connecting' | 'live' | 'offline';

/** `192.168.1.5:3001` or `http://host:3001/` → `http://192.168.1.5:3001`. */
export function normaliseServer(raw: string): string {
  const s = (raw || '').trim().replace(/\/+$/, '');
  if (!s) return '';
  return /^https?:\/\//i.test(s) ? s : `http://${s}`;
}

/**
 * The board's live feed from the SMES server.
 *
 * Refetches whenever the server pushes `anchorMappingUpdate` over socket.io —
 * just the anchor mappings when the push says only a queue changed, everything
 * otherwise — and all of it every POLL_MS in case a push was missed. Beside
 * the board it keeps the watched line's closed boxes, refetched on each
 * `partCompleted` push. Only ever started in the browser — never during the
 * pre-render.
 */
@Injectable({ providedIn: 'root' })
export class BoardFeed {
  private http = inject(HttpClient);
  private zone = inject(NgZone);

  /** The latest data; null until the first fetch lands. */
  readonly snapshot = signal<BoardSnapshot | null>(null);
  /** Socket state — what the footer chip shows. */
  readonly status = signal<FeedStatus>('connecting');
  /** When the snapshot was last replaced. */
  readonly updatedAt = signal<Date | null>(null);
  /** The last fetch failed (server unreachable); the previous snapshot stays up. */
  readonly fetchError = signal(false);
  /** Boxes closed on the watched line since the watched time, newest first;
   *  null until they have been read for the line and time now watched. */
  readonly completions = signal<PartCompletion[] | null>(null);

  private refresh$ = new Subject<void>();
  private completions$ = new Subject<void>();
  private watched: { line: string; from: string } | null = null;
  /** Set when any push since the last fetch needs more than the boards. Kept
   *  outside the stream so the throttle cannot drop a `line` push in favour of
   *  a later `board` one. */
  private needsAll = true;
  private sub?: Subscription;
  private socket?: ReturnType<typeof io>;
  private server = '';
  /** Attached while running; see start(). */
  private onVisible = () => {
    if (document.visibilityState !== 'visible') return;
    // A TV waking from standby (or an emulator restored from a snapshot)
    // resumes with a socket that still reads as connected but is long dead,
    // and would only notice after the ~30 s heartbeat timeout. Refetch now,
    // and cycle the socket so pushes resume straight away.
    this.request('all');
    this.completions$.next();
    if (this.socket) {
      this.socket.close();
      this.socket.open();
    }
  };
  /** Bumped by every start/stop, so a start overtaken mid-import backs out. */
  private generation = 0;

  /** (Re)connects to `server`. Safe to call again after a settings change. */
  async start(server: string): Promise<void> {
    this.stop();
    const generation = this.generation;
    this.server = normaliseServer(server);
    if (!this.server) return;

    this.status.set('connecting');
    this.needsAll = true;
    document.addEventListener('visibilitychange', this.onVisible);
    this.sub = merge(
      this.refresh$.pipe(throttleTime(PUSH_THROTTLE_MS, asyncScheduler, { leading: true, trailing: true })),
      interval(POLL_MS).pipe(map(() => this.request('all', false))),
    )
      .pipe(
        startWith(void 0),
        switchMap(() => {
          const scope: Scope = this.needsAll || !this.snapshot() ? 'all' : 'board';
          this.needsAll = false;
          return this.fetch(scope);
        }),
      )
      .subscribe((snap) => {
        if (!snap) {
          this.fetchError.set(true);
          return;
        }
        this.fetchError.set(false);
        this.snapshot.set(snap);
        this.updatedAt.set(new Date());
      });

    // A different server has different boxes.
    this.completions.set(null);
    this.sub.add(
      merge(
        this.completions$.pipe(throttleTime(PUSH_THROTTLE_MS, asyncScheduler, { leading: true, trailing: true })),
        interval(POLL_MS),
      )
        .pipe(startWith(void 0), switchMap(() => this.fetchCompletions()))
        .subscribe((rows) => {
          if (rows) this.completions.set(rows);
        }),
    );

    // Loaded lazily so the socket client never enters the server bundle's
    // pre-render path. v2 client, to match the server's socket.io 2.x.
    const { default: connect } = await import('socket.io-client');
    // A settings change while the import was in flight has already moved on.
    if (generation !== this.generation) return;

    // Socket callbacks fire outside Angular's zone; signals would still update,
    // but running inside it keeps timers and change detection conventional.
    const socket = connect(this.server, { reconnection: true, reconnectionDelayMax: 10_000 });
    socket.on('connect', () => this.zone.run(() => {
      this.status.set('live');
      // Catch up on anything pushed while disconnected.
      this.request('all');
      this.completions$.next();
    }));
    socket.on('disconnect', () => this.zone.run(() => this.status.set('offline')));
    socket.on('connect_error', () => this.zone.run(() => this.status.set('offline')));
    socket.on(BOARD_EVENT, (payload?: { scope?: string }) =>
      this.zone.run(() => this.request(payload?.scope === 'board' ? 'board' : 'all')));
    // Every line's boxes are pushed to every screen; only this line's matter.
    socket.on(COMPLETED_EVENT, (payload?: { lineCode?: string }) =>
      this.zone.run(() => {
        if (!payload?.lineCode || payload.lineCode === this.watched?.line) this.completions$.next();
      }));
    this.socket = socket;
  }

  /** Keeps `completions` to the boxes closed on `line` since `from` (ISO).
   *  Safe to call on every change of either; the same pair is a no-op. */
  watchCompletions(line: string, from: string): void {
    if (this.watched?.line === line && this.watched.from === from) return;
    this.watched = line ? { line, from } : null;
    this.completions.set(null);
    this.completions$.next();
  }

  private fetchCompletions() {
    const watched = this.watched;
    if (!this.server || !watched) return of(null);
    const params = { line: watched.line, from: watched.from, size: String(COMPLETIONS_PAGE) };
    return this.http.get<{ rows: PartCompletion[] }>(`${this.server}/part-completion`, { params }).pipe(
      // A line switched mid-flight answers the question before last.
      map((res) => (this.watched === watched ? res?.rows || [] : null)),
      catchError(() => of(null)),
    );
  }

  /** Refetch now — for a line change, which needs no new connection. */
  refresh(): void {
    this.request('all');
  }

  /** Marks what the next fetch must cover and, unless `emit` is off (the poll
   *  drives its own tick), triggers it. */
  private request(scope: Scope, emit = true): void {
    if (scope === 'all') this.needsAll = true;
    if (emit) this.refresh$.next();
  }

  stop(): void {
    this.generation++;
    document.removeEventListener('visibilitychange', this.onVisible);
    this.sub?.unsubscribe();
    this.sub = undefined;
    this.socket?.off(BOARD_EVENT);
    this.socket?.off(COMPLETED_EVENT);
    this.socket?.close();
    this.socket = undefined;
  }

  private fetch(scope: Scope) {
    const get = <T>(path: string) => this.http.get<T>(`${this.server}/${path}`);
    const prev = this.snapshot();
    if (scope === 'board' && prev) {
      return get<AnchorMapping[]>('anchor-mapping').pipe(
        map((boards): BoardSnapshot => ({ ...prev, boards: boards || [] })),
        catchError(() => of(null)),
      );
    }
    return forkJoin({
      lines: get<SmesLine[]>('line'),
      boards: get<AnchorMapping[]>('anchor-mapping'),
      // The shift only labels the header; a failure there must not blank the board.
      shifts: get<SmesShift[]>('shift').pipe(catchError(() => of([] as SmesShift[]))),
      // Only the boxes' plans read the products, for their cycle times. A
      // failure keeps the ones already read, so no plan blinks off for a poll.
      products: get<{ rows?: ProductPacking[] }>('product-packing').pipe(
        map((r) => r?.rows || []),
        catchError(() => of(prev?.products || [])),
      ),
    }).pipe(
      map((r): BoardSnapshot => ({
        lines: (r.lines || []).filter((l) => l.IS_ACTIVE !== false),
        boards: r.boards || [],
        shifts: r.shifts || [],
        products: r.products,
      })),
      catchError(() => of(null)),
    );
  }
}
