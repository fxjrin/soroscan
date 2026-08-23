import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { fetchHealth, rpcCall } from "./client";
import { resetFailoverState, UpstreamError } from "@/lib/failover";

beforeEach(() => {
  resetFailoverState();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubRpc(reply: (requestId: number) => object) {
  const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as { id: number };
    return new Response(JSON.stringify(reply(request.id)), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

test("sends a well-formed json-rpc request and unwraps the result", async () => {
  const fetchMock = stubRpc((id) => ({
    jsonrpc: "2.0",
    id,
    result: {
      status: "healthy",
      latestLedger: 123,
      latestLedgerCloseTime: 1,
      oldestLedger: 1,
      oldestLedgerCloseTime: 1,
      ledgerRetentionWindow: 120960,
    },
  }));

  const health = await fetchHealth("testnet");

  expect(health.latestLedger).toBe(123);
  const sent = JSON.parse(
    String((fetchMock.mock.calls[0][1] as RequestInit).body),
  );
  expect(sent).toMatchObject({ jsonrpc: "2.0", method: "getHealth" });
  expect(typeof sent.id).toBe("number");
});

test("returns a legitimate null result", async () => {
  stubRpc((id) => ({ jsonrpc: "2.0", id, result: null }));

  await expect(rpcCall<null>("testnet", "getSomething")).resolves.toBeNull();
});

test("surfaces object-shaped json-rpc errors", async () => {
  stubRpc((id) => ({
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: "method not found" },
  }));

  await expect(rpcCall("testnet", "getBogus")).rejects.toThrowError(
    /method not found/,
  );
});

test("surfaces string-shaped provider errors", async () => {
  stubRpc((id) => ({ jsonrpc: "2.0", id, error: "rate limited" }));

  await expect(rpcCall("testnet", "getHealth")).rejects.toThrowError(
    /rate limited/,
  );
});

test("rejects a response with no result member", async () => {
  stubRpc((id) => ({ jsonrpc: "2.0", id }));

  await expect(rpcCall("testnet", "getHealth")).rejects.toThrowError(
    /no result/,
  );
});

test("rejects a response whose id does not match the request", async () => {
  stubRpc((id) => ({ jsonrpc: "2.0", id: id + 1, result: {} }));

  await expect(rpcCall("testnet", "getHealth")).rejects.toThrowError(
    /id mismatch/,
  );
});

test("rejects a malformed getHealth body instead of returning it", async () => {
  stubRpc((id) => ({ jsonrpc: "2.0", id, result: {} }));

  const failure = await fetchHealth("testnet").catch((error) => error);

  expect(failure).toBeInstanceOf(UpstreamError);
  expect(String(failure)).toMatch(/malformed/);
});
