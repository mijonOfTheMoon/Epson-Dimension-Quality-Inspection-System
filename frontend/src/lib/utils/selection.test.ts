import { describe, expect, it } from "vitest";

import type { ObjectDetection } from "$lib/types/api";
import {
  isSelected,
  measurementStatusLabel,
  nextSelection,
  resolveSelection,
  selectionPresent,
  type SelectionKey,
  type StationDetectionGroup,
} from "./selection";

function makeDetection(id: string): ObjectDetection {
  return {
    id,
    label: `detection-${id}`,
    bbox: { x: 0, y: 0, width: 1, height: 1 },
    status: "OK",
    confidenceScore: 0.9,
    measurements: [],
    polygon: [],
  };
}

function makeGroups(): Map<string, StationDetectionGroup> {
  return new Map([
    ["station-1", { stationId: "station-1", detections: [makeDetection("a"), makeDetection("b")] }],
  ]);
}

describe("measurementStatusLabel", () => {
  it("maps each status to its Indonesian label", () => {
    expect(measurementStatusLabel("OK")).toBe("Sesuai");
    expect(measurementStatusLabel("NG")).toBe("Tidak sesuai");
    expect(measurementStatusLabel("UNREADABLE")).toBe("Tidak terbaca");
  });
});

describe("nextSelection", () => {
  it("returns a selection key built from the clicked target", () => {
    expect(nextSelection({ stationId: "station-1", detectionId: "a" })).toEqual({
      stationId: "station-1",
      detectionId: "a",
    });
  });
});

describe("isSelected", () => {
  const key: SelectionKey = { stationId: "station-1", detectionId: "a" };

  it("returns false when nothing is selected", () => {
    expect(isSelected(null, "station-1", "a")).toBe(false);
  });

  it("returns true only when both station and detection match", () => {
    expect(isSelected(key, "station-1", "a")).toBe(true);
    expect(isSelected(key, "station-1", "b")).toBe(false);
    expect(isSelected(key, "station-2", "a")).toBe(false);
  });
});

describe("resolveSelection", () => {
  const groups = makeGroups();

  it("returns null for an empty selection", () => {
    expect(resolveSelection(null, groups)).toBeNull();
  });

  it("returns null when the station is unknown", () => {
    expect(resolveSelection({ stationId: "station-x", detectionId: "a" }, groups)).toBeNull();
  });

  it("returns null when the detection is missing in the station", () => {
    expect(resolveSelection({ stationId: "station-1", detectionId: "z" }, groups)).toBeNull();
  });

  it("returns the matching detection", () => {
    expect(resolveSelection({ stationId: "station-1", detectionId: "b" }, groups)?.id).toBe("b");
  });
});

describe("selectionPresent", () => {
  const groups = makeGroups();

  it("reflects whether the selection resolves to a detection", () => {
    expect(selectionPresent({ stationId: "station-1", detectionId: "a" }, groups)).toBe(true);
    expect(selectionPresent({ stationId: "station-1", detectionId: "z" }, groups)).toBe(false);
    expect(selectionPresent(null, groups)).toBe(false);
  });
});
