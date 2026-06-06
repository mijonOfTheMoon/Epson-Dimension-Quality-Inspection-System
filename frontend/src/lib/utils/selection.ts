import type { MeasurementStatus, ObjectDetection } from '$lib/types/api';

const MEASUREMENT_STATUS_LABELS: Record<MeasurementStatus, string> = {
  OK: 'Sesuai',
  NG: 'Tidak sesuai',
  UNREADABLE: 'Tidak terbaca',
};

export function measurementStatusLabel(status: MeasurementStatus): string {
  return MEASUREMENT_STATUS_LABELS[status];
}

export interface SelectionKey {
  stationId: string;
  detectionId: string;
}

export interface StationDetectionGroup {
  stationId: string;
  detections: ObjectDetection[];
}

export function nextSelection(clicked: SelectionKey): SelectionKey {
  return { stationId: clicked.stationId, detectionId: clicked.detectionId };
}

export function isSelected(
  key: SelectionKey | null,
  stationId: string,
  detectionId: string,
): boolean {
  if (key === null) {
    return false;
  }
  return key.stationId === stationId && key.detectionId === detectionId;
}

export function resolveSelection(
  key: SelectionKey | null,
  groups: Map<string, StationDetectionGroup>,
): ObjectDetection | null {
  if (key === null) {
    return null;
  }
  const group = groups.get(key.stationId);
  if (group === undefined) {
    return null;
  }
  return group.detections.find((detection) => detection.id === key.detectionId) ?? null;
}

export function selectionPresent(
  key: SelectionKey | null,
  groups: Map<string, StationDetectionGroup>,
): boolean {
  return resolveSelection(key, groups) !== null;
}
