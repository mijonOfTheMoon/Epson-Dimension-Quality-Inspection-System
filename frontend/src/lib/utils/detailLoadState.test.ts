import { describe, expect, it } from "vitest";

import { DETAIL_TIMEOUT_MS, detailLoadReducer, type DetailLoadState } from "./detailLoadState";

const IDLE: DetailLoadState = { phase: "idle" };

describe("detailLoadReducer", () => {
  it("starts loading when a row is expanded", () => {
    expect(detailLoadReducer(IDLE, { type: "expand" })).toEqual({ phase: "loading" });
  });

  it("marks the detail as loaded once resolved", () => {
    expect(detailLoadReducer({ phase: "loading" }, { type: "resolve" })).toEqual({ phase: "loaded" });
  });

  it("keeps the rejection reason when the request fails", () => {
    expect(detailLoadReducer({ phase: "loading" }, { type: "reject", error: "404" })).toEqual({
      phase: "error",
      error: "404",
    });
  });

  it("uses a localized message when the request times out", () => {
    expect(detailLoadReducer({ phase: "loading" }, { type: "timeout" })).toEqual({
      phase: "error",
      error: "Waktu muat detail habis",
    });
  });

  it("returns to idle when the row collapses", () => {
    expect(detailLoadReducer({ phase: "error", error: "404" }, { type: "collapse" })).toEqual({
      phase: "idle",
    });
  });

  it("exposes a ten second detail timeout budget", () => {
    expect(DETAIL_TIMEOUT_MS).toBe(10000);
  });
});
