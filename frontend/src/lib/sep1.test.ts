import { afterEach, expect, test, vi } from "vitest";
import {
  fetchTomlCurrencies,
  findCurrency,
  parseTomlCurrencies,
  sanitizeImageUrl,
} from "./sep1";

const ISSUER = "GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("parses real-world spacing and quoting variants", () => {
  const toml = `
VERSION = "2.0.0"
ACCOUNTS = ["${ISSUER}"]

[DOCUMENTATION]
ORG_NAME = "Aqua"

[[CURRENCIES]]
code = "AQUA"
issuer = "${ISSUER}"
name = "AQUA"
image="https://aqua.network/assets/img/aqua-logo.png"
display_decimals = 7

[[ CURRENCIES ]]
code='USDX'
issuer = '${ISSUER}'
`;
  const currencies = parseTomlCurrencies(toml);
  expect(currencies).toEqual([
    {
      code: "AQUA",
      issuer: ISSUER,
      name: "AQUA",
      image: "https://aqua.network/assets/img/aqua-logo.png",
      displayDecimals: 7,
    },
    { code: "USDX", issuer: ISSUER },
  ]);
});

test("an entry without code and issuer is dropped, later ones survive", () => {
  const toml = `
[[CURRENCIES]]
name = "nameless"

[[CURRENCIES]]
code = "OK"
issuer = "${ISSUER}"
display_decimals = "not a number"
`;
  const currencies = parseTomlCurrencies(toml);
  expect(currencies).toEqual([{ code: "OK", issuer: ISSUER }]);
});

test("a later section ends the currency entry", () => {
  const toml = `
[[CURRENCIES]]
code = "OK"
issuer = "${ISSUER}"

[DOCUMENTATION]
name = "not a currency name"
`;
  expect(parseTomlCurrencies(toml)[0].name).toBeUndefined();
});

test("finds a currency by exact code and issuer pair", () => {
  const currencies = [
    { code: "AQUA", issuer: "GAAA" },
    { code: "AQUA", issuer: ISSUER, name: "the real one" },
  ];
  expect(findCurrency(currencies, "AQUA", ISSUER)?.name).toBe("the real one");
  expect(findCurrency(currencies, "AQUA", "GBBB")).toBeUndefined();
});

test("image urls survive only as https", () => {
  expect(sanitizeImageUrl("https://a.example/logo.png")).toBe(
    "https://a.example/logo.png",
  );
  expect(sanitizeImageUrl("http://a.example/logo.png")).toBeUndefined();
  expect(sanitizeImageUrl("javascript:alert(1)")).toBeUndefined();
  expect(sanitizeImageUrl("not a url")).toBeUndefined();
  expect(sanitizeImageUrl(undefined)).toBeUndefined();
});

test("refuses to fetch from a home domain that is not a public hostname", async () => {
  await expect(fetchTomlCurrencies("not a domain")).rejects.toThrowError(
    /not a fetchable home domain/,
  );
  await expect(fetchTomlCurrencies("localhost")).rejects.toThrowError(
    /not a fetchable home domain/,
  );
});

test("fetches, checks the size cap, and parses", async () => {
  const fetchMock = vi.fn(
    async (_url: unknown) =>
      new Response(`[[CURRENCIES]]\ncode = "OK"\nissuer = "${ISSUER}"\n`),
  );
  vi.stubGlobal("fetch", fetchMock);

  const currencies = await fetchTomlCurrencies("aqua.network");

  expect(String(fetchMock.mock.calls[0][0])).toBe(
    "https://aqua.network/.well-known/stellar.toml",
  );
  expect(currencies).toEqual([{ code: "OK", issuer: ISSUER }]);

  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("x".repeat(200 * 1024))),
  );
  await expect(fetchTomlCurrencies("aqua.network")).rejects.toThrowError(
    /too large/,
  );
});
