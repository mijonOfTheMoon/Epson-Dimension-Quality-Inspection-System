import { describe, expect, it } from "vitest";

import type { BoundingBox, ObjectDetection } from "$lib/types/api";
import { resolveEntryOverlay } from "./historyOverlay";

function makeDetection(bbox: BoundingBox, overrides: Partial<ObjectDetection> = {}): ObjectDetection {
  return {
    id: "det-1",
    label: "bolt",
    bbox,
    status: "OK",
    confidenceScore: 0.9,
    measurements: [],
    polygon: [
      [10, 10],
      [30, 40],
    ],
    ...overrides,
  };
}

describe("resolveEntryOverlay", () => {
  it("reports missing when there is no detection", () => {
    expect(resolveEntryOverlay(null)).toEqual({ positioned: false, reason: "missing" });
    expect(resolveEntryOverlay(undefined)).toEqual({ positioned: false, reason: "missing" });
  });

  it("rejects boxes that extend past the normalized frame", () => {
    const result = resolveEntryOverlay(makeDetection({ x: 90, y: 0, width: 20, height: 10 }));
    expect(result).toEqual({ positioned: false, reason: "out-of-bounds" });
  });

  it("rejects boxes with negative or zero dimensions", () => {
    expect(resolveEntryOverlay(makeDetection({ x: -1, y: 0, width: 10, height: 10 }))).toEqual({
      positioned: false,
      reason: "out-of-bounds",
    });
    expect(resolveEntryOverlay(makeDetection({ x: 0, y: 0, width: 0, height: 10 }))).toEqual({
      positioned: false,
      reason: "out-of-bounds",
    });
  });

  it("rejects boxes with non-finite coordinates", () => {
    expect(resolveEntryOverlay(makeDetection({ x: Number.NaN, y: 0, width: 10, height: 10 }))).toEqual({
      positioned: false,
      reason: "out-of-bounds",
    });
  });

  it("positions a valid detection and carries its status and polygon", () => {
    const detection = makeDetection({ x: 10, y: 10, width: 20, height: 30 }, { status: "NG" });
    const result = resolveEntryOverlay(detection);

    expect(result.positioned).toBe(true);
    if (result.positioned) {
      expect(result.box.scanId).toBe("det-1");
      expect(result.box.status).toBe("NG");
      expect(result.box.bbox).toEqual({ x: 10, y: 10, width: 20, height: 30 });
      expect(result.box.polygon).toEqual([
        [10, 10],
        [30, 40],
      ]);
    }
  });
});
