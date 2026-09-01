import { expect, test } from "vitest";
import { networkUrl, resolveNetwork } from "./network";

test("resolveNetwork picks the network from the subdomain", () => {
  expect(resolveNetwork("testnet.soroscan.io", "")).toBe("testnet");
  expect(resolveNetwork("futurenet.soroscan.io", "")).toBe("futurenet");
  expect(resolveNetwork("soroscan.io", "")).toBe("mainnet");
});

test("resolveNetwork falls back to the query param for local dev", () => {
  expect(resolveNetwork("localhost", "?network=testnet")).toBe("testnet");
  expect(resolveNetwork("localhost", "?network=futurenet")).toBe("futurenet");
  expect(resolveNetwork("localhost", "?network=mainnet")).toBe("mainnet");
  expect(resolveNetwork("localhost", "")).toBe("mainnet");
});

test("networkUrl switches subdomains in production", () => {
  const loc = { hostname: "soroscan.io", pathname: "/tx/abc", search: "" };
  expect(networkUrl(loc, "testnet")).toBe("https://testnet.soroscan.io/tx/abc");
  expect(networkUrl(loc, "futurenet")).toBe(
    "https://futurenet.soroscan.io/tx/abc",
  );
  expect(
    networkUrl(
      { hostname: "testnet.soroscan.io", pathname: "/", search: "" },
      "mainnet",
    ),
  ).toBe("https://soroscan.io/");
});

test("networkUrl uses the query param elsewhere", () => {
  expect(
    networkUrl({ hostname: "localhost", pathname: "/", search: "" }, "testnet"),
  ).toBe("/?network=testnet");
  expect(
    networkUrl(
      { hostname: "localhost", pathname: "/", search: "" },
      "futurenet",
    ),
  ).toBe("/?network=futurenet");
  expect(
    networkUrl(
      {
        hostname: "localhost",
        pathname: "/ledger/5",
        search: "?network=testnet",
      },
      "mainnet",
    ),
  ).toBe("/ledger/5");
});
