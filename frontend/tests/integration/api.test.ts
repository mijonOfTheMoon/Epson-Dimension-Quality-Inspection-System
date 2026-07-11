import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, ApiRequestError, tokenStorage } from "$lib/services/api";

const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe("api service request pipeline", () => {
  it("sends JSON bodies and parses the response for login", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ token: "jwt-token", user: { id: "u1" } }));

    const result = await api.login("operator", "secret");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/auth/login");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ username: "operator", password: "secret" }));
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(result).toEqual({ token: "jwt-token", user: { id: "u1" } });
  });

  it("attaches the bearer token from storage on authenticated requests", async () => {
    tokenStorage.set("stored-token");
    fetchMock.mockResolvedValue(jsonResponse({ id: "u1", username: "operator" }));

    await api.me();

    const [, init] = fetchMock.mock.calls[0];
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer stored-token");
  });

  it("maps a 429 response to an ApiRequestError with the retry-after hint", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ message: "slow down" }, { status: 429, headers: { "Retry-After": "5" } }),
    );

    const error = await api.getUsers().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as ApiRequestError).status).toBe(429);
    expect((error as ApiRequestError).retryAfterMs).toBe(5000);
    expect((error as ApiRequestError).message).toBe("slow down");
  });

  it("clears the stored token on a 401 response", async () => {
    tokenStorage.set("stored-token");
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));

    await expect(api.me()).rejects.toBeInstanceOf(ApiRequestError);
    expect(tokenStorage.get()).toBeNull();
  });

  it("builds the query string and normalizes inspection events", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([
        { eventId: "e1", partName: "Bracket", partCode: "BRK-1", status: "OK", stationId: "s1", timestamp: "2024-01-01T00:00:00Z" },
      ]),
    );

    const result = await api.getInspections({ limit: 5, status: "OK", includeDetections: true });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/inspections?limit=5&status=OK&includeDetections=true");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("e1");
    expect(result[0].vendor).toBe("-");
    expect(result[0].confidenceScore).toBe(0);
  });

  it("returns undefined for a 204 no content response", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await expect(api.deletePart("part-1")).resolves.toBeUndefined();
  });

  it("creates a part with a JSON payload", async () => {
    const input = {
      partName: "Bracket",
      partCode: "BRK-1",
      vendor: "Acme",
      dimensions: [],
    };
    fetchMock.mockResolvedValue(jsonResponse({ id: "p1", ...input }));

    const created = await api.createPart(input);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/parts");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify(input));
    expect(created.id).toBe("p1");
  });

  it("patches a quality record status", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "q1", status: "shipped" }));

    await api.updateQualityStatus("q1", "shipped");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/quality-records/q1/status");
    expect(init?.method).toBe("PATCH");
    expect(init?.body).toBe(JSON.stringify({ status: "shipped" }));
  });

  it("normalizes a single inspection detail", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        eventId: "e9",
        partName: "Bracket",
        partCode: "BRK-1",
        status: "NG",
        stationId: "s2",
        timestamp: "2024-02-02T10:00:00Z",
        confidenceScore: 0.42,
      }),
    );

    const detail = await api.getInspectionDetail("e9");

    expect(fetchMock.mock.calls[0][0]).toBe("/api/inspections/e9");
    expect(detail.id).toBe("e9");
    expect(detail.status).toBe("NG");
    expect(detail.confidenceScore).toBe(0.42);
    expect(detail.detections).toEqual([]);
  });

  it("falls back to an empty channel list when share discovery fails", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));

    await expect(api.getShareChannels()).resolves.toEqual([]);
  });

  it("falls back to the cloudflare transport when realtime config fails", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }));

    await expect(api.getRealtimeConfig()).resolves.toEqual({ videoTransport: "cloudflare" });
  });

  it("uploads an avatar as multipart form data without a JSON content type", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ objectKey: "avatars/u1.jpg" }));

    await api.uploadAvatar(new Blob(["binary"], { type: "image/jpeg" }));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/users/avatar");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeInstanceOf(FormData);
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
  });
});
