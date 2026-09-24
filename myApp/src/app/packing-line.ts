/**
 * The packing-line board's data: its shape, and the sample line it shows until
 * it is fed from the server.
 *
 * Everything the board prints as a total — each anchor's packed / target and
 * percentage, the line's overall progress and completion — is derived from the
 * stations in AppComponent, so only the stations carry numbers here.
 */

/** What a station is doing right now. It colours the pill, the border and the bar. */
export type StationStatus = 'running' | 'waiting' | 'completed' | 'breakdown' | 'idle';

export interface Station {
  /** Station code, e.g. WS-01. */
  code: string;
  status: StationStatus;
  /** The part being packed, e.g. CRK-458912. */
  partNo: string;
  partName: string;
  /** Who the running product is for. */
  customer: string;
  operator: string;
  /** What the station moves on to once this part is done. */
  nextPartNo: string;
  nextQty: number;
  packed: number;
  target: number;
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

export interface PackingLine {
  code: string;
  name: string;
  shift: { name: string; code: string; start: string; end: string };
  /** The line's customer. */
  customer: string;
  anchors: Anchor[];
  systems: SystemChip[];
}

export const SAMPLE_LINE: PackingLine = {
  code: 'LN-04',
  name: 'Crankshaft Packing Line',
  shift: { name: 'Morning Shift', code: 'Shift A', start: '06:00', end: '14:00' },
  customer: 'Sandfits Precision Works',
  anchors: [
    {
      code: 'A',
      name: 'Anchor A',
      stations: [
        {
          code: 'WS-01', status: 'running',
          partNo: 'CRK-458912', partName: 'Crankshaft — 4 Cyl Forged',
          customer: 'John Smith', operator: 'Rahul',
          nextPartNo: 'CRK-458913', nextQty: 300,
          packed: 198, target: 250,
        },
        {
          code: 'WS-02', status: 'waiting',
          partNo: 'CAM-220741', partName: 'Camshaft — Intake Assembly',
          customer: 'Michael Grant', operator: 'David',
          nextPartNo: 'CAM-220742', nextQty: 260,
          packed: 130, target: 220,
        },
        {
          code: 'WS-03', status: 'completed',
          partNo: 'PST-118305', partName: 'Piston Assembly — 82mm',
          customer: 'Anita Rao', operator: 'Suresh',
          nextPartNo: 'PST-118306', nextQty: 280,
          packed: 300, target: 300,
        },
        {
          code: 'WS-04', status: 'breakdown',
          partNo: 'CYL-770214', partName: 'Cylinder Head — Alloy',
          customer: 'Peter Wu', operator: 'Karthik',
          nextPartNo: 'CYL-770215', nextQty: 240,
          packed: 68, target: 240,
        },
      ],
    },
    {
      code: 'B',
      name: 'Anchor B',
      stations: [
        {
          code: 'WS-05', status: 'running',
          partNo: 'GBX-330918', partName: 'Gearbox Housing — MT6',
          customer: 'Laura Chen', operator: 'Imran',
          nextPartNo: 'GBX-330919', nextQty: 320,
          packed: 260, target: 320,
        },
        {
          code: 'WS-06', status: 'idle',
          partNo: 'FLY-905117', partName: 'Flywheel — Dual Mass',
          customer: 'Daniel Cruz', operator: 'Vignesh',
          nextPartNo: 'FLY-905118', nextQty: 200,
          packed: 0, target: 280,
        },
        {
          code: 'WS-07', status: 'running',
          partNo: 'ROD-441026', partName: 'Connecting Rod — Fractured',
          customer: 'Sarah Miller', operator: 'Ajay',
          nextPartNo: 'ROD-441027', nextQty: 400,
          packed: 307, target: 400,
        },
        {
          code: 'WS-08', status: 'waiting',
          partNo: 'VLV-612093', partName: 'Valve Cover — Cast Alu',
          customer: 'Ramesh Iyer', operator: 'Manoj',
          nextPartNo: 'VLV-612094', nextQty: 300,
          packed: 302, target: 390,
        },
      ],
    },
  ],
  systems: [
    { label: 'Network online', detail: '16 ms', tone: 'ok' },
    { label: 'System normal', tone: 'ok' },
    { label: 'PLC link · OPC-UA', tone: 'info' },
    { label: 'MES v4.2.1', tone: 'plain' },
  ],
};
