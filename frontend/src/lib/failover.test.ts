import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  fetchJsonWithFailover,
  resetFailoverState,
  UpstreamError,
} from "./failover";

beforeEach(() => {
  resetFailoverState();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function response(status: number, body = "{}") {
  return new Response(body, { status });
}

test("returns the parsed body of the first successful response", async () => {
  const fetchMock = vi.fn(async () => response(200, '{"value":1}'));
  vi.stubGlobal("fetch", fetchMock);

  const result = await fetchJsonWithFailover<{ value: number }>(
    ["https://a.test"],
    "/x",
  );

  expect(result).toMatchObject({ status: 200, ok: true, body: { value: 1 } });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("rotates to the next provider on 500, 429, and 403", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(response(500))
    .mockResolvedValueOnce(response(429))
    .mockResolvedValueOnce(response(403))
    .mockResolvedValueOnce(response(200));
  vi.stubGlobal("fetch", fetchMock);

  const result = await fetchJsonWithFailover(
    ["https://a.test", "https://b.test", "https://c.test", "https://d.test"],
    "/x",
  );

  expect(result.status).toBe(200);
  expect(fetchMock).toHaveBeenCalledTimes(4);
  expect(fetchMock.mock.calls[3][0]).toBe("https://d.test/x");
});

test("passes 404 through with its body without rotating", async () => {
  const fetchMock = vi.fn(async () =>
    response(404, '{"title":"Resource Missing"}'),
  );
  vi.stubGlobal("fetch", fetchMock);

  const result = await fetchJsonWithFailover<{ title: string }>(
    ["https://a.test", "https://b.test"],
    "/x",
  );

  expect(result).toMatchObject({
    status: 404,
    ok: false,
    body: { title: "Resource Missing" },
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("rotates when a provider returns a non-JSON body", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(response(200, "<html>captive portal</html>"))
    .mockResolvedValueOnce(response(200, '{"value":2}'));
  vi.stubGlobal("fetch", fetchMock);

  const result = await fetchJsonWithFailover<{ value: number }>(
    ["https://a.test", "https://b.test"],
    "/x",
  );

  expect(result.body.value).toBe(2);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("remembers the last healthy provider for later calls", async () => {
  const fetchMock = vi
    .fn()
    .mockRejectedValueOnce(new Error("connection refused"))
    .mockImplementation(async () => response(200));
  vi.stubGlobal("fetch", fetchMock);

  await fetchJsonWithFailover(["https://a.test", "https://b.test"], "/x");
  await fetchJsonWithFailover(["https://a.test", "https://b.test"], "/y");

  expect(fetchMock.mock.calls[2][0]).toBe("https://b.test/y");
});

test("does not rotate when the caller aborted", async () => {
  const fetchMock = vi.fn(async () => {
    throw new DOMException("aborted", "AbortError");
  });
  vi.stubGlobal("fetch", fetchMock);
  const controller = new AbortController();
  controller.abort();

  await expect(
    fetchJsonWithFailover(
      ["https://a.test", "https://b.test"],
      "/x",
      undefined,
      controller.signal,
    ),
  ).rejects.toThrowError();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("throws the last upstream error with its status when every provider fails", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response(503)),
  );

  const failure = await fetchJsonWithFailover(["https://a.test"], "/x").catch(
    (error) => error,
  );

  expect(failure).toBeInstanceOf(UpstreamError);
  expect((failure as UpstreamError).status).toBe(503);
});

test("propagates the last thrown network error when every provider is unreachable", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Promise.reject(new Error("dns failure"))),
  );

  await expect(
    fetchJsonWithFailover(["https://a.test", "https://b.test"], "/x"),
  ).rejects.toThrow("dns failure");
});
