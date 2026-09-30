/**
 * The packing-line board's data: its shape, as the board reads it.
 *
 * Everything the board prints as a total — each anchor's packed / target and
 * percentage, the line's overall progress and completion — is derived from the
 * stations in AppComponent, so only the stations carry numbers here.
 */

/** What a station is doing right now. It colours the pill, the border and the dial. */
export type StationStatus = 'running' | 'waiting' | 'completed' | 'breakdown' | 'idle';

export interface Station {
  /** Machine code, e.g. M-01. */
  code: string;
  /** The cell the machine sits on, shown as C1. */
  cellNo: number;
  machineName: string;
  status: StationStatus;
  /** The product running now, and who it is for. */
  product: string;
  customer: string;
  /** The part being inspected and boxed: its number (e.g. KL040270) and its
   *  component name, which falls back to the number while there is none. */
  partNo: string;
  partName: string;
  /** Where that part sits in the product's run — part 1 of 2. */
  partStep: number;
  partCount: number;
  operator: string;
  /** Pieces in the box, and the box quantity. */
  packed: number;
  target: number;
  /** How long one piece of the part takes, in seconds, off the product master;
   *  0 when it has no cycle time. With the box quantity it plans the box. */
  cycleSec: number;
  /** Which box this is — the queue entry and the part — so the next box of the
   *  same part, queued again, gets a plan of its own. Empty with no part. */
  boxId: string;
  /** The part packed once this box fills — the product's next part, else the
   *  first part of the product queued behind it — and its box quantity. Empty
   *  when nothing is queued after this box. */
  nextPartNo: string;
  nextPartName: string;
  nextQty: number;
  /** Where that part sits in this product's run; 0 when it is another product's. */
  nextStep: number;
  /** The product that next part belongs to, when it is not this one. */
  nextProduct: string;
  /** Products queued behind the one the next part belongs to. */
  queued: number;
}

/** One side of the line, with the stations placed on it. */
export interface Anchor {
  /** Single letter shown in the badge, e.g. A. */
  code: string;
  name: string;
  stations: Station[];
}

/** A chip in the footer's status strip. */
export interface SystemChip {
  label: string;
  /** Quieter text after the label, e.g. a latency. */
  detail?: string;
  tone: 'ok' | 'info' | 'warn' | 'plain';
}

export interface Shift {
  name: string;
  code: string;
  /** 24-hour HH:mm, for the header. */
  start: string;
  end: string;
  /** Minutes past midnight, for the shift's progress; null without a shift. */
  startMin: number | null;
  endMin: number | null;
}

export interface PackingLine {
  code: string;
  name: string;
  shift: Shift;
  /** The line's customer. */
  customer: string;
  anchors: Anchor[];
  systems: SystemChip[];
}
