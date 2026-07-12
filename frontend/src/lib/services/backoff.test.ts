import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "$lib/services/api";
import { createPollingBackoff } from "./backoff";

describe("createPollingBackoff", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests immediately after creation", () => {
    const backoff = createPollingBackoff();
    expect(backoff.canRequest()).toBe(true);
  });

  it("blocks requests after a server error and recovers after the base delay", () => {
    const backoff = createPollingBackoff(15000, 60000);

    backoff.recordFailure(new ApiRequestError("server", 500));
    expect(backoff.canRequest()).toBe(false);

    vi.advanceTimersByTime(14999);
    expect(backoff.canRequest()).toBe(false);

    vi.advanceTimersByTime(1);
    expect(backoff.canRequest()).toBe(true);
  });

  it("grows the delay exponentially on repeated failures", () => {
    const backoff = createPollingBackoff(15000, 60000);

    backoff.recordFailure(new ApiRequestError("server", 500));
    vi.advanceTimersByTime(15000);
    expect(backoff.canRequest()).toBe(true);

    backoff.recordFailure(new ApiRequestError("server", 500));
    vi.advanceTimersByTime(29999);
    expect(backoff.canRequest()).toBe(false);

    vi.advanceTimersByTime(1);
    expect(backoff.canRequest()).toBe(true);
  });

  it("honours the retry-after hint from a 429 response", () => {
    const backoff = createPollingBackoff(15000, 60000);

    backoff.recordFailure(new ApiRequestError("rate limited", 429, 5000));
    vi.advanceTimersByTime(4999);
    expect(backoff.canRequest()).toBe(false);

    vi.advanceTimersByTime(1);
    expect(backoff.canRequest()).toBe(true);
  });

  it("caps the delay at the configured maximum", () => {
    const backoff = createPollingBackoff(15000, 60000);

    backoff.recordFailure(new ApiRequestError("rate limited", 429, 999999));
    vi.advanceTimersByTime(60000);
    expect(backoff.canRequest()).toBe(true);
  });

  it("ignores client errors other than 429", () => {
    const backoff = createPollingBackoff();

    backoff.recordFailure(new ApiRequestError("bad request", 400));
    expect(backoff.canRequest()).toBe(true);
  });

  it("resets the failure state", () => {
    const backoff = createPollingBackoff(15000, 60000);

    backoff.recordFailure(new ApiRequestError("server", 500));
    expect(backoff.canRequest()).toBe(false);

    backoff.reset();
    expect(backoff.canRequest()).toBe(true);
  });
});
