import { expect, test } from "@playwright/test";
import { blockLiveHosts } from "./hermetic";

const G = "GADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOZPI";
const HASH = "a2b4c6d8e0a2b4c6d8e0a2b4c6d8e0a2b4c6d8e0a2b4c6d8e0a2b4c6d8e0a2b4";

test.beforeEach(async ({ page }) => {
  await blockLiveHosts(page);
});

test("search routes a G address to the account page", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search" }).fill(G);
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(`/account/${G}`);
  await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
  await expect(page.getByText("GADQ...OZPI")).toBeVisible();
});

test("search routes a ledger sequence and keeps the testnet param", async ({
  page,
}) => {
  await page.goto("/?network=testnet");
  await expect(page.getByText("Testnet")).toBeVisible();

  await page.getByRole("searchbox", { name: "Search" }).fill("64090000");
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL("/ledger/64090000?network=testnet");
  await expect(page.getByRole("heading", { name: "Ledger" })).toBeVisible();
});

test("search rejects garbage with an inline hint", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search" }).fill("hello world");
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL("/");
  await expect(page.getByRole("alert")).toBeVisible();
});

test("a direct transaction URL renders the shell", async ({ page }) => {
  await page.goto(`/tx/${HASH}`);

  await expect(
    page.getByRole("heading", { name: "Transaction" }),
  ).toBeVisible();
  await expect(page.getByText("a2b4...a2b4")).toBeVisible();
});

test("direct URLs with invalid identifiers render the invalid state", async ({
  page,
}) => {
  await page.goto("/account/not-an-address");
  await expect(
    page.getByRole("heading", { name: "Not a valid account address" }),
  ).toBeVisible();

  await page.goto("/tx/zzzz");
  await expect(
    page.getByRole("heading", { name: "Not a valid transaction hash" }),
  ).toBeVisible();

  await page.goto("/ledger/99999999999");
  await expect(
    page.getByRole("heading", { name: "Not a valid ledger sequence" }),
  ).toBeVisible();
});

test("an uppercase transaction hash URL is accepted and normalized", async ({
  page,
}) => {
  await page.goto(`/tx/${HASH.toUpperCase()}`);

  await expect(
    page.getByRole("heading", { name: "Transaction" }),
  ).toBeVisible();
  await expect(page.getByText("a2b4...a2b4")).toBeVisible();
});
