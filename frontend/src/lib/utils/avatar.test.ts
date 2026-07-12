import { describe, expect, it } from "vitest";

import { avatarPlaceholder, DEFAULT_AVATAR_PLACEHOLDER } from "./avatar";

describe("avatarPlaceholder", () => {
  it("returns the uppercased first letter of the name", () => {
    expect(avatarPlaceholder("andi")).toBe("A");
    expect(avatarPlaceholder("Budi")).toBe("B");
  });

  it("skips leading non-letter characters", () => {
    expect(avatarPlaceholder("  citra")).toBe("C");
    expect(avatarPlaceholder("123deni")).toBe("D");
  });

  it("uppercases accented and unicode letters", () => {
    expect(avatarPlaceholder("émile")).toBe("É");
  });

  it("falls back to the placeholder when there is no letter", () => {
    expect(avatarPlaceholder("")).toBe(DEFAULT_AVATAR_PLACEHOLDER);
    expect(avatarPlaceholder("123")).toBe(DEFAULT_AVATAR_PLACEHOLDER);
    expect(avatarPlaceholder("-_-")).toBe(DEFAULT_AVATAR_PLACEHOLDER);
  });
});
