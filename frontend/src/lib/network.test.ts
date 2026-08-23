import { expect, test } from "vitest";
import { networkToggleUrl, resolveNetwork } from "./network";

test("resolveNetwork picks testnet from the subdomain", () => {
  expect(resolveNetwork("testnet.soroscan.io", "")).toBe("testnet");
  expect(resolveNetwork("soroscan.io", "")).toBe("mainnet");
});

test("resolveNetwork falls back to the query param for local dev", () => {
  expect(resolveNetwork("localhost", "?network=testnet")).toBe("testnet");
  expect(resolveNetwork("localhost", "?network=mainnet")).toBe("mainnet");
  expect(resolveNetwork("localhost", "")).toBe("mainnet");
});

test("networkToggleUrl switches subdomains in production", () => {
  expect(
    networkToggleUrl({
      hostname: "soroscan.io",
      pathname: "/tx/abc",
      search: "",
    }),
  ).toBe("https://testnet.soroscan.io/tx/abc");
  expect(
    networkToggleUrl({
      hostname: "testnet.soroscan.io",
      pathname: "/",
      search: "",
    }),
  ).toBe("https://soroscan.io/");
});

test("networkToggleUrl switches the query param elsewhere", () => {
  expect(
    networkToggleUrl({ hostname: "localhost", pathname: "/", search: "" }),
  ).toBe("/?network=testnet");
  expect(
    networkToggleUrl({
      hostname: "localhost",
      pathname: "/ledger/5",
      search: "?network=testnet",
    }),
  ).toBe("/ledger/5");
});
