import { expect, test } from "@playwright/test";
import { blockLiveHosts } from "./hermetic";

const G = "GADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOZPI";

test.beforeEach(async ({ page }) => {
  await blockLiveHosts(page);
});

test("slash opens the omnibox and enter jumps to the entity", async ({
  page,
}) => {
  await page.goto("/");
  await page.keyboard.press("/");

  const input = page.getByPlaceholder(
    "Account, contract, tx hash, or ledger sequence",
  );
  await expect(input).toBeVisible();

  await input.fill("64090000");
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL("/ledger/64090000");
  await expect(page.getByRole("heading", { name: "Ledger" })).toBeVisible();
});

test("the header search button opens the omnibox and remembers recents", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Search/ }).click();

  const input = page.getByPlaceholder(
    "Account, contract, tx hash, or ledger sequence",
  );
  await input.fill(G);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`/account/${G}`);

  await page.getByRole("button", { name: /Search/ }).click();
  await expect(page.getByText("Recent")).toBeVisible();
});

test("corrupted recents storage never crashes the app", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem("soroscan.recent-searches", "null");
  });
  await page.keyboard.press("/");

  await expect(page.getByText("What you can search")).toBeVisible();
});
