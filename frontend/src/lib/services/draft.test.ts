import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearDraft, loadDraft, saveDraft } from "./draft";

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("part editor drafts", () => {
  it("round-trips a stored draft", () => {
    saveDraft("part-editor", { partName: "Bracket", partCode: "BRK-1" });
    expect(loadDraft("part-editor")).toEqual({ partName: "Bracket", partCode: "BRK-1" });
  });

  it("returns null when no draft is stored", () => {
    expect(loadDraft("missing")).toBeNull();
  });

  it("strips inline data-url previews before persisting", () => {
    saveDraft("part-editor", {
      partName: "Bracket",
      thumbnail: "data:image/png;base64,AAAA",
      dimensions: [{ name: "width", nominal: 10, preview: "data:image/jpeg;base64,BBBB" }],
    });

    expect(loadDraft("part-editor")).toEqual({
      partName: "Bracket",
      dimensions: [{ name: "width", nominal: 10 }],
    });
  });

  it("removes data-url entries from arrays of strings", () => {
    saveDraft("frames", ["frame-a.png", "data:image/png;base64,CCCC", "frame-b.png"]);
    expect(loadDraft("frames")).toEqual(["frame-a.png", "frame-b.png"]);
  });

  it("clears a stored draft", () => {
    saveDraft("part-editor", { partName: "Bracket" });
    clearDraft("part-editor");
    expect(loadDraft("part-editor")).toBeNull();
  });
});
