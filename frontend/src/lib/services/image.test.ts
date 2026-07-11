import { describe, expect, it } from "vitest";

import { fileToAvatarBlob, MAX_AVATAR_FILE_BYTES } from "./image";

describe("fileToAvatarBlob validation", () => {
  it("rejects files that are not images", async () => {
    const file = new File(["plain text"], "notes.txt", { type: "text/plain" });
    await expect(fileToAvatarBlob(file)).rejects.toThrow("File harus berupa gambar.");
  });

  it("rejects images larger than the maximum size", async () => {
    const oversized = new File([new Uint8Array(MAX_AVATAR_FILE_BYTES + 1)], "big.png", {
      type: "image/png",
    });
    await expect(fileToAvatarBlob(oversized)).rejects.toThrow("Ukuran gambar maksimal 5 MB.");
  });
});
