import type { BoundingBox, InspectionStatus, ObjectDetection } from '$lib/types/api';

export interface OverlayBox {
  scanId: string;
  label: string;
  status: InspectionStatus;
  bbox: BoundingBox;
  polygon: [number, number][];
}

export type OverlayResult =
  | { positioned: true; box: OverlayBox }
  | { positioned: false; reason: 'missing' | 'out-of-bounds' };

function isWithinBounds(bbox: BoundingBox): boolean {
  return (
    Number.isFinite(bbox.x) &&
    Number.isFinite(bbox.y) &&
    Number.isFinite(bbox.width) &&
    Number.isFinite(bbox.height) &&
    bbox.x >= 0 &&
    bbox.y >= 0 &&
    bbox.width > 0 &&
    bbox.height > 0 &&
    bbox.x + bbox.width <= 100 &&
    bbox.y + bbox.height <= 100
  );
}

export function resolveEntryOverlay(detection: ObjectDetection | null | undefined): OverlayResult {
  if (!detection || !detection.bbox) {
    return { positioned: false, reason: 'missing' };
  }

  if (!isWithinBounds(detection.bbox)) {
    return { positioned: false, reason: 'out-of-bounds' };
  }

  return {
    positioned: true,
    box: {
      scanId: detection.id,
      label: detection.id,
      status: detection.status,
      bbox: detection.bbox,
      polygon: Array.isArray(detection.polygon) ? detection.polygon : [],
    },
  };
}
