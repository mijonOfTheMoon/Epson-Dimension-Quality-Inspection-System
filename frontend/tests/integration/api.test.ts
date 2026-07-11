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
});
