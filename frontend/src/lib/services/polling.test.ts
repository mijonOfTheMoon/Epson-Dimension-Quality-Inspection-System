import { describe, expect, it } from "vitest";

import { deepEqual } from "./polling";

describe("deepEqual", () => {
  it("treats identical primitives as equal", () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual("OK", "OK")).toBe(true);
    expect(deepEqual(1, 2)).toBe(false);
  });

  it("treats NaN as equal to NaN", () => {
    expect(deepEqual(Number.NaN, Number.NaN)).toBe(true);
  });

  it("compares nested objects structurally", () => {
    const a = { partCode: "BRK-1", spec: { nominal: 10, tolerance: 0.2 } };
    const b = { partCode: "BRK-1", spec: { nominal: 10, tolerance: 0.2 } };
    expect(deepEqual(a, b)).toBe(true);
    expect(deepEqual(a, { partCode: "BRK-1", spec: { nominal: 10, tolerance: 0.3 } })).toBe(false);
  });

  it("detects differing key counts and missing keys", () => {
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(deepEqual({ a: 1 }, { b: 1 })).toBe(false);
  });

  it("compares arrays element by element", () => {
    expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
  });

  it("does not treat an array as equal to a plain object", () => {
    expect(deepEqual([1, 2], { 0: 1, 1: 2 })).toBe(false);
  });

  it("handles null comparisons", () => {
    expect(deepEqual(null, null)).toBe(true);
    expect(deepEqual(null, {})).toBe(false);
  });
});
