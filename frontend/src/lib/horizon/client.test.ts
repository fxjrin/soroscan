import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { fetchLatestLedgers, horizonGet, NotFoundError } from "./client";
import { resetFailoverState, UpstreamError } from "@/lib/failover";

beforeEach(() => {
  resetFailoverState();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function response(status: number, body = "{}") {
  return new Response(body, { status });
}

test("builds the query string and hits the first provider", async () => {
  const fetchMock = vi.fn(async (_url: unknown, _init?: unknown) =>
    response(200, '{"_embedded":{"records":[]}}'),
  );
  vi.stubGlobal("fetch", fetchMock);

  await fetchLatestLedgers("testnet", 3);

  expect(fetchMock.mock.calls[0][0]).toBe(
    "https://horizon-testnet.stellar.org/ledgers?order=desc&limit=3",
  );
});

test("maps 404 to NotFoundError instead of a provider failure", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response(404, '{"title":"Resource Missing"}')),
  );

  await expect(
    horizonGet("testnet", "/accounts/GMISSING"),
  ).rejects.toBeInstanceOf(NotFoundError);
});

test("fails over to the second horizon on 500", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(response(500))
    .mockResolvedValueOnce(response(200, '{"_embedded":{"records":[]}}'));
  vi.stubGlobal("fetch", fetchMock);

  const page = await fetchLatestLedgers("mainnet", 1);

  expect(page._embedded.records).toEqual([]);
  expect(String(fetchMock.mock.calls[1][0])).toContain(
    "horizon.stellar.lobstr.co",
  );
});

test("maps other non-ok statuses to UpstreamError with the status", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response(400, '{"title":"Bad Request"}')),
  );

  const failure = await horizonGet("testnet", "/ledgers").catch(
    (error) => error,
  );

  expect(failure).toBeInstanceOf(UpstreamError);
  expect((failure as UpstreamError).status).toBe(400);
});
