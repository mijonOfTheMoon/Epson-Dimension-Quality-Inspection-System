// Mock data for the Dimensional Inspection QC System

export type UserRole = 'operator' | 'qc' | 'supervisor' | 'engineering' | 'admin' | 'vendor';

export interface User {
  id: string;
  username: string;
  password: string;
  name: string;
  role: UserRole;
  avatar?: string;
}

export interface PartType {
  id: string;
  partName: string;
  partCode: string;
  vendor: string;
  dimensions: DimensionSpec[];
}

export interface DimensionSpec {
  id: string;
  name: string;
  nominal: number;
  upperLimit: number;
  lowerLimit: number;
  unit: string;
}

export interface InspectionResult {
  id: string;
  partId: string;
  partName: string;
  partCode: string;
  batchNo: string;
  vendor: string;
  operatorId: string;
  operatorName: string;
  timestamp: string;
  status: 'OK' | 'NG';
  shift: 'A' | 'B' | 'C';
  line: string;
  confidenceScore: number;
  measurements: Measurement[];
  imageUrl?: string;
  ngAction?: 'hold' | 'return' | 'rework' | 'sorting' | null;
}

export interface Measurement {
  dimensionName: string;
  measured: number;
  nominal: number;
  upperLimit: number;
  lowerLimit: number;
  unit: string;
  status: 'OK' | 'NG';
}

export interface Discrepancy {
  id: string;
  partCode: string;
  partName: string;
  vendor: string;
  vendorQty: number;
  actualQty: number;
  difference: number;
  status: 'open' | 'resolved' | 'claimed';
  reportedAt: string;
  resolvedAt?: string;
}

// ADD new interfaces
export type RequestStatus = 'not_requested' | 'requested' | 'in_progress' | 'shipped' | 'received';

export interface StatusHistoryEntry {
  status: RequestStatus;
  timestamp: string;
  changedBy: string;
}

export interface QualityTrackingRecord {
  id: string;
  date: string;
  partCode: string;
  partName: string;
  vendor: string;
  totalScanned: number;
  ngCount: number;
  ngRate: number;
  requestStatus: RequestStatus;
  statusHistory: StatusHistoryEntry[];
}

export interface Notification {
  id: string;
  type: 'ng_detected' | 'discrepancy' | 'system';
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
}

// ---- Users ----
export const users: User[] = [
  { id: 'u1', username: 'operator1', password: 'pass', name: 'Budi Santoso', role: 'operator' },
  { id: 'u2', username: 'qc1', password: 'pass', name: 'Siti Rahayu', role: 'qc' },
  { id: 'u3', username: 'supervisor1', password: 'pass', name: 'Ahmad Wijaya', role: 'supervisor' },
  { id: 'u4', username: 'eng1', password: 'pass', name: 'Dian Pratama', role: 'engineering' },
  { id: 'u5', username: 'admin', password: 'admin', name: 'Admin System', role: 'admin' },
  { id: 'u6', username: 'vendor1', password: 'pass', name: 'PT. Mitra Sejahtera', role: 'vendor' },
];

// ---- Part Types ----
export const partTypes: PartType[] = [
  {
    id: 'pt1',
    partName: 'Spur Gear A',
    partCode: 'SG-001',
    vendor: 'PT. Mitra Sejahtera',
    dimensions: [
      { id: 'd1', name: 'Outer Diameter', nominal: 12.00, upperLimit: 12.05, lowerLimit: 11.95, unit: 'mm' },
      { id: 'd2', name: 'Inner Diameter', nominal: 4.00, upperLimit: 4.03, lowerLimit: 3.97, unit: 'mm' },
      { id: 'd3', name: 'Thickness', nominal: 2.50, upperLimit: 2.55, lowerLimit: 2.45, unit: 'mm' },
    ],
  },
  {
    id: 'pt2',
    partName: 'Holder B',
    partCode: 'HLD-002',
    vendor: 'PT. Komponen Utama',
    dimensions: [
      { id: 'd4', name: 'Length', nominal: 25.00, upperLimit: 25.10, lowerLimit: 24.90, unit: 'mm' },
      { id: 'd5', name: 'Width', nominal: 15.00, upperLimit: 15.08, lowerLimit: 14.92, unit: 'mm' },
      { id: 'd6', name: 'Hole Diameter', nominal: 5.00, upperLimit: 5.05, lowerLimit: 4.95, unit: 'mm' },
    ],
  },
  {
    id: 'pt3',
    partName: 'Screw M3',
    partCode: 'SCR-003',
    vendor: 'PT. Baut Nusantara',
    dimensions: [
      { id: 'd7', name: 'Shaft Diameter', nominal: 3.00, upperLimit: 3.02, lowerLimit: 2.98, unit: 'mm' },
      { id: 'd8', name: 'Head Diameter', nominal: 5.50, upperLimit: 5.55, lowerLimit: 5.45, unit: 'mm' },
      { id: 'd9', name: 'Total Length', nominal: 8.00, upperLimit: 8.10, lowerLimit: 7.90, unit: 'mm' },
    ],
  },
  {
    id: 'pt4',
    partName: 'Pin Shaft C',
    partCode: 'PIN-004',
    vendor: 'PT. Mitra Sejahtera',
    dimensions: [
      { id: 'd10', name: 'Diameter', nominal: 2.00, upperLimit: 2.02, lowerLimit: 1.98, unit: 'mm' },
      { id: 'd11', name: 'Length', nominal: 10.00, upperLimit: 10.05, lowerLimit: 9.95, unit: 'mm' },
    ],
  },
];

// ---- Generate Inspection Results ----
function generateInspections(): InspectionResult[] {
  const results: InspectionResult[] = [];
  const shifts: ('A' | 'B' | 'C')[] = ['A', 'B', 'C'];
  const lines = ['Line-1', 'Line-2', 'Line-3'];
  const baseDate = new Date('2026-04-01');

  let id = 1;
  for (let day = 0; day < 9; day++) {
    const date = new Date(baseDate);
    date.setDate(date.getDate() + day);

    for (let i = 0; i < 45; i++) {
      const pt = partTypes[Math.floor(Math.random() * partTypes.length)];
      const shift = shifts[Math.floor(Math.random() * 3)];
      const line = lines[Math.floor(Math.random() * 3)];
      const isNG = Math.random() < 0.06;

      const measurements: Measurement[] = pt.dimensions.map((d) => {
        const deviation = isNG && Math.random() < 0.5
          ? (Math.random() > 0.5 ? 0.08 : -0.08)
          : (Math.random() - 0.5) * (d.upperLimit - d.lowerLimit) * 0.8;
        const measured = parseFloat((d.nominal + deviation).toFixed(3));
        const mStatus = measured >= d.lowerLimit && measured <= d.upperLimit ? 'OK' : 'NG';
        return {
          dimensionName: d.name,
          measured,
          nominal: d.nominal,
          upperLimit: d.upperLimit,
          lowerLimit: d.lowerLimit,
          unit: d.unit,
          status: mStatus as 'OK' | 'NG',
        };
      });

      const hasNG = measurements.some((m) => m.status === 'NG');
      const hours = Math.floor(Math.random() * 24);
      const mins = Math.floor(Math.random() * 60);
      date.setHours(hours, mins, 0, 0);

      results.push({
        id: `INS-${String(id++).padStart(5, '0')}`,
        partId: pt.id,
        partName: pt.partName,
        partCode: pt.partCode,
        batchNo: `B${String(day + 1).padStart(3, '0')}-${String(Math.floor(Math.random() * 100)).padStart(3, '0')}`,
        vendor: pt.vendor,
        operatorId: 'u1',
        operatorName: 'Budi Santoso',
        timestamp: date.toISOString(),
        status: hasNG ? 'NG' : 'OK',
        shift,
        line,
        confidenceScore: parseFloat((85 + Math.random() * 15).toFixed(1)),
        measurements,
        ngAction: hasNG ? (['hold', 'return', 'rework', 'sorting'] as const)[Math.floor(Math.random() * 4)] : null,
      });
    }
  }
  return results.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

export const inspectionResults = generateInspections();

// ---- Discrepancies ----
export const discrepancies: Discrepancy[] = [
  { id: 'disc-1', partCode: 'SG-001', partName: 'Spur Gear A', vendor: 'PT. Mitra Sejahtera', vendorQty: 1000, actualQty: 970, difference: -30, status: 'open', reportedAt: '2026-04-05T10:30:00Z' },
  { id: 'disc-2', partCode: 'HLD-002', partName: 'Holder B', vendor: 'PT. Komponen Utama', vendorQty: 500, actualQty: 515, difference: 15, status: 'resolved', reportedAt: '2026-04-03T08:15:00Z', resolvedAt: '2026-04-04T14:00:00Z' },
  { id: 'disc-3', partCode: 'SCR-003', partName: 'Screw M3', vendor: 'PT. Baut Nusantara', vendorQty: 5000, actualQty: 4850, difference: -150, status: 'claimed', reportedAt: '2026-04-02T09:00:00Z', resolvedAt: '2026-04-06T11:00:00Z' },
  { id: 'disc-4', partCode: 'PIN-004', partName: 'Pin Shaft C', vendor: 'PT. Mitra Sejahtera', vendorQty: 2000, actualQty: 1960, difference: -40, status: 'open', reportedAt: '2026-04-07T14:20:00Z' },
];

// ---- Notifications ----
export const notifications: Notification[] = [
  { id: 'n1', type: 'ng_detected', title: 'Part NG Terdeteksi', message: 'Spur Gear A (SG-001) batch B003-045 - Outer Diameter out of tolerance', timestamp: '2026-04-09T08:30:00Z', read: false },
  { id: 'n2', type: 'ng_detected', title: 'Part NG Beruntun', message: '3 part NG berturut-turut pada Line-2 Shift A', timestamp: '2026-04-09T07:15:00Z', read: false },
  { id: 'n3', type: 'discrepancy', title: 'Discrepancy Baru', message: 'Selisih kuantitas Pin Shaft C dari PT. Mitra Sejahtera: -40 pcs', timestamp: '2026-04-07T14:20:00Z', read: true },
  { id: 'n4', type: 'system', title: 'Kalibrasi Diperlukan', message: 'Kamera Station-1 perlu dikalibrasi ulang (terakhir: 30 hari lalu)', timestamp: '2026-04-06T06:00:00Z', read: true },
];

// ---- Quality Tracking Records ----
function generateQualityTracking(): QualityTrackingRecord[] {
  const records: QualityTrackingRecord[] = [];
  const statuses: RequestStatus[] = ['not_requested', 'requested', 'in_progress', 'shipped', 'received'];
  const baseDate = new Date('2026-04-01');

  let id = 1;
  for (let day = 0; day < 9; day++) {
    const date = new Date(baseDate);
    date.setDate(date.getDate() + day);
    const dateStr = date.toISOString().split('T')[0];

    for (const pt of partTypes) {
      const totalScanned = 80 + Math.floor(Math.random() * 120);
      const ngCount = Math.floor(Math.random() * (totalScanned * 0.12));
      const ngRate = parseFloat(((ngCount / totalScanned) * 100).toFixed(1));

      // Determine request status based on NG rate severity and day
      let requestStatus: RequestStatus = 'not_requested';
      const historyEntries: StatusHistoryEntry[] = [
        { status: 'not_requested', timestamp: `${dateStr}T08:00:00Z`, changedBy: 'System' },
      ];

      if (ngRate > 5) {
        if (day < 3) {
          requestStatus = 'received';
          historyEntries.push(
            { status: 'requested', timestamp: `${dateStr}T09:00:00Z`, changedBy: 'Dian Pratama' },
            { status: 'in_progress', timestamp: `${dateStr}T11:00:00Z`, changedBy: pt.vendor },
            { status: 'shipped', timestamp: `${dateStr}T15:00:00Z`, changedBy: pt.vendor },
            { status: 'received', timestamp: new Date(date.getTime() + 86400000).toISOString().replace(/T.*/, 'T09:00:00Z'), changedBy: 'Dian Pratama' },
          );
        } else if (day < 5) {
          requestStatus = 'shipped';
          historyEntries.push(
            { status: 'requested', timestamp: `${dateStr}T09:00:00Z`, changedBy: 'Dian Pratama' },
            { status: 'in_progress', timestamp: `${dateStr}T11:00:00Z`, changedBy: pt.vendor },
            { status: 'shipped', timestamp: `${dateStr}T16:00:00Z`, changedBy: pt.vendor },
          );
        } else if (day < 7) {
          requestStatus = 'in_progress';
          historyEntries.push(
            { status: 'requested', timestamp: `${dateStr}T09:30:00Z`, changedBy: 'Dian Pratama' },
            { status: 'in_progress', timestamp: `${dateStr}T13:00:00Z`, changedBy: pt.vendor },
          );
        } else if (day < 8) {
          requestStatus = 'requested';
          historyEntries.push(
            { status: 'requested', timestamp: `${dateStr}T10:00:00Z`, changedBy: 'Dian Pratama' },
          );
        }
      } else if (ngRate > 3 && day < 4) {
        requestStatus = 'requested';
        historyEntries.push(
          { status: 'requested', timestamp: `${dateStr}T10:00:00Z`, changedBy: 'Dian Pratama' },
        );
      }

      records.push({
        id: `QT-${String(id++).padStart(4, '0')}`,
        date: dateStr,
        partCode: pt.partCode,
        partName: pt.partName,
        vendor: pt.vendor,
        totalScanned,
        ngCount,
        ngRate,
        requestStatus,
        statusHistory: historyEntries,
      });
    }
  }
  return records.sort((a, b) => b.date.localeCompare(a.date));
}

export const qualityTrackingRecords = generateQualityTracking();