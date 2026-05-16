import type { StoreState } from '../domain/types.js';

export const seedState: StoreState = {
  inspections: [],
  stations: [],
  alerts: [],
  users: [
    { id: 'u1', username: 'operator1', password: 'pass', name: 'Budi Santoso', role: 'operator' },
    { id: 'u2', username: 'qc1', password: 'pass', name: 'Siti Rahayu', role: 'qc' },
    { id: 'u3', username: 'supervisor1', password: 'pass', name: 'Ahmad Wijaya', role: 'supervisor' },
    { id: 'u4', username: 'eng1', password: 'pass', name: 'Dian Pratama', role: 'engineering' },
    { id: 'u5', username: 'admin', password: 'admin', name: 'Admin System', role: 'admin' },
    { id: 'u6', username: 'vendor1', password: 'pass', name: 'PT. Mitra Sejahtera', role: 'vendor' },
  ],
  parts: [
    {
      id: 'pt1',
      partName: 'Spur Gear A',
      partCode: 'SG-001',
      vendor: 'PT. Mitra Sejahtera',
      dimensions: [
        { id: 'd1', name: 'Outer Diameter', nominal: 12, upperLimit: 12.05, lowerLimit: 11.95, unit: 'mm' },
        { id: 'd2', name: 'Inner Diameter', nominal: 4, upperLimit: 4.03, lowerLimit: 3.97, unit: 'mm' },
        { id: 'd3', name: 'Thickness', nominal: 2.5, upperLimit: 2.55, lowerLimit: 2.45, unit: 'mm' },
      ],
    },
    {
      id: 'pt2',
      partName: 'Holder B',
      partCode: 'HLD-002',
      vendor: 'PT. Komponen Utama',
      dimensions: [
        { id: 'd4', name: 'Length', nominal: 25, upperLimit: 25.1, lowerLimit: 24.9, unit: 'mm' },
        { id: 'd5', name: 'Width', nominal: 15, upperLimit: 15.08, lowerLimit: 14.92, unit: 'mm' },
        { id: 'd6', name: 'Hole Diameter', nominal: 5, upperLimit: 5.05, lowerLimit: 4.95, unit: 'mm' },
      ],
    },
    {
      id: 'pt3',
      partName: 'Screw M3',
      partCode: 'SCR-003',
      vendor: 'PT. Baut Nusantara',
      dimensions: [
        { id: 'd7', name: 'Shaft Diameter', nominal: 3, upperLimit: 3.02, lowerLimit: 2.98, unit: 'mm' },
        { id: 'd8', name: 'Head Diameter', nominal: 5.5, upperLimit: 5.55, lowerLimit: 5.45, unit: 'mm' },
        { id: 'd9', name: 'Total Length', nominal: 8, upperLimit: 8.1, lowerLimit: 7.9, unit: 'mm' },
      ],
    },
    {
      id: 'pt4',
      partName: 'Pin Shaft C',
      partCode: 'PIN-004',
      vendor: 'PT. Mitra Sejahtera',
      dimensions: [
        { id: 'd10', name: 'Diameter', nominal: 2, upperLimit: 2.02, lowerLimit: 1.98, unit: 'mm' },
        { id: 'd11', name: 'Length', nominal: 10, upperLimit: 10.05, lowerLimit: 9.95, unit: 'mm' },
      ],
    },
  ],
  qualityRecords: [],
};
