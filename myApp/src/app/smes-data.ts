/**
 * The slice of the SMES server's data the board reads, and how it becomes a
 * PackingLine.
 *
 * The shapes mirror main-server/src/ts-models/smes (line, anchor_mapping and
 * smes_shift .interface.ts), trimmed to the fields used here, and the queue
 * rules mirror main-ui/src/app/shared/product-queue.ts. This app is built on
 * its own and cannot import either, so change them together.
 */

import { Anchor, PackingLine, Station, StationStatus, SystemChip } from './packing-line';

export interface SmesMachine {
  MACHINE_CODE: string;
  MACHINE_NAME: string;
  ANCHOR_NO?: number;
  CELL_NO?: number;
}

export interface SmesLine {
  LINE_CODE: string;
  LINE_NAME: string;
  CUSTOMER_NAME?: string;
  MACHINES: SmesMachine[];
  IS_ACTIVE: boolean;
}

export interface QueuedPart {
  /** The part number — the key predates the number/component split. */
  PART_NAME: string;
  COMP_NAME?: string;
  PACKING_QTY: number;
  DONE_QTY: number;
  IS_DONE: boolean;
}

export interface QueuedProduct {
  PRODUCT_NAME?: string;
  CUSTOMER_NAME?: string;
  WORKER_NO: string;
  WORKER_NAME?: string;
  PARTS: QueuedPart[];
}

export interface AnchorCell {
  CELL_NO: number;
  QUEUE: QueuedProduct[];
}

export interface AnchorMapping {
  _id?: string;
  LINE_CODE: string;
  ANCHORS: { ANCHOR_NO: number; CELLS: AnchorCell[] }[];
}

export interface SmesShift {
  SHIFT_CODE?: string;
  FROM_TIME: string;
  TO_TIME: string;
  order?: number;
}

/** Everything one refresh fetches. */
export interface BoardSnapshot {
  lines: SmesLine[];
  boards: AnchorMapping[];
  shifts: SmesShift[];
}

/** Fixed shape of the board — see ANCHOR_NOS on the server. */
const ANCHOR_NOS = [1, 2];
const ANCHOR_LETTER: Record<number, string> = { 1: 'A', 2: 'B' };

// ── Queue reading (mirror of product-queue.ts) ──────────────────────────────

function isProductDone(entry: QueuedProduct): boolean {
  const parts = entry?.PARTS || [];
  return parts.length > 0 && parts.every((p) => p.IS_DONE);
}

function pendingProducts(cell: AnchorCell | undefined): QueuedProduct[] {
  return (cell?.QUEUE || []).filter((e) => !isProductDone(e));
}

/** The component name, or the part number while there is no component name. */
function partLabel(part: QueuedPart | undefined): string {
  return (part?.COMP_NAME || '').trim() || (part?.PART_NAME || '').trim();
}

// ── Shift ───────────────────────────────────────────────────────────────────

/** Minutes past midnight. The shift master stores "08:00:00 AM"; a plain
 *  24-hour "08:00" is read too. */
function minutesOf(time: string): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i.exec((time || '').trim());
  if (!m) return null;
  let h = Number(m[1]) % (m[3] ? 12 : 24);
  if (m[3]?.toUpperCase() === 'PM') h += 12;
  return h * 60 + Number(m[2]);
}

/** 24-hour "HH:mm" for the header, whatever the stored form. */
function clockOf(time: string): string {
  const mins = minutesOf(time);
  if (mins === null) return time || '--:--';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
}

/** The shift the clock is in now. Handles one that runs past midnight. */
function currentShift(shifts: SmesShift[], now: Date): SmesShift | undefined {
  const t = now.getHours() * 60 + now.getMinutes();
  return shifts.find((s) => {
    const from = minutesOf(s.FROM_TIME);
    const to = minutesOf(s.TO_TIME);
    if (from === null || to === null) return false;
    return from <= to ? t >= from && t < to : t >= from || t < to;
  });
}

// ── Mapping ─────────────────────────────────────────────────────────────────

function stationFor(machine: SmesMachine, cell: AnchorCell | undefined): Station {
  const pending = pendingProducts(cell);
  const now = pending[0];
  const undone = (now?.PARTS || []).filter((p) => !p.IS_DONE);
  const part = undone[0];

  // What comes after this box: the product's next part, else the first part of
  // the product queued behind it.
  const nextPart = undone[1] ?? pending[1]?.PARTS?.find((p) => !p.IS_DONE);

  let status: StationStatus;
  if (!cell?.QUEUE?.length) status = 'idle';
  else if (!now) status = 'completed';
  else if (!((part?.DONE_QTY || 0) > 0)) status = 'waiting';
  else status = 'running';

  return {
    code: machine.MACHINE_CODE || `C${machine.CELL_NO}`,
    status,
    partNo: part?.PART_NAME || '—',
    partName: [now?.PRODUCT_NAME, part ? partLabel(part) : ''].filter(Boolean).join(' — ') || 'No product queued',
    customer: now?.CUSTOMER_NAME || '—',
    operator: now?.WORKER_NAME || now?.WORKER_NO || '—',
    nextPartNo: partLabel(nextPart) || '—',
    nextQty: nextPart?.PACKING_QTY || 0,
    packed: part?.DONE_QTY || 0,
    target: part?.PACKING_QTY || 0,
  };
}

/**
 * The board for one line. Cells come from the line's machines (a cell exists
 * only once a machine sits on it); what each is making comes from that line's
 * anchor mapping.
 */
export function toPackingLine(
  snap: BoardSnapshot,
  lineCode: string,
  systems: SystemChip[],
  now = new Date(),
): PackingLine {
  const line = snap.lines.find((l) => l.LINE_CODE === lineCode);
  const board = snap.boards.find((b) => b.LINE_CODE === lineCode);

  const anchors: Anchor[] = ANCHOR_NOS.map((anchorNo) => {
    const cells = board?.ANCHORS?.find((a) => Number(a.ANCHOR_NO) === anchorNo)?.CELLS || [];
    const stations = (line?.MACHINES || [])
      .filter((m) => Number(m.ANCHOR_NO) === anchorNo && m.CELL_NO != null)
      .sort((a, b) => (a.CELL_NO || 0) - (b.CELL_NO || 0))
      .map((m) => stationFor(m, cells.find((c) => Number(c.CELL_NO) === Number(m.CELL_NO))));
    return { code: ANCHOR_LETTER[anchorNo], name: `Anchor ${anchorNo}`, stations };
  });

  const shift = currentShift(snap.shifts, now);
  const shiftCode = shift?.SHIFT_CODE || (shift?.order != null ? String(shift.order) : '');

  return {
    code: line?.LINE_CODE || lineCode || '—',
    name: line?.LINE_NAME || line?.LINE_CODE || 'Line not found',
    shift: shift
      ? { name: `Shift ${shiftCode}`, code: shiftCode, start: clockOf(shift.FROM_TIME), end: clockOf(shift.TO_TIME) }
      : { name: 'No shift', code: '—', start: '--:--', end: '--:--' },
    customer: line?.CUSTOMER_NAME || '—',
    anchors,
    systems,
  };
}
