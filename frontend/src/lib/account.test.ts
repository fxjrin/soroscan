import { expect, test } from "vitest";
import { enabledFlags, sortedBalances, xlmBreakdown } from "./account";
import type { AccountRecord, BalanceRecord } from "./horizon/client";

const G = "GADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOZPI";

function account(overrides: Partial<AccountRecord> = {}): AccountRecord {
  return {
    id: G,
    account_id: G,
    sequence: "203069091936010245",
    subentry_count: 0,
    last_modified_ledger: 64000123,
    balances: [{ balance: "100.0000000", asset_type: "native" }],
    signers: [{ key: G, weight: 1, type: "ed25519_public_key" }],
    thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
    flags: {
      auth_required: false,
      auth_revocable: false,
      auth_immutable: false,
      auth_clawback_enabled: false,
    },
    ...overrides,
  };
}

test("a bare account reserves the two base entries", () => {
  expect(xlmBreakdown(account())).toEqual({
    total: "100",
    reserved: "1",
    liabilities: "0",
    spendable: "99",
  });
});

test("every subentry adds half an XLM to the reserve", () => {
  const breakdown = xlmBreakdown(account({ subentry_count: 3 }));

  expect(breakdown?.reserved).toBe("2.5");
  expect(breakdown?.spendable).toBe("97.5");
});

test("sponsoring another account's entries is paid for here", () => {
  const breakdown = xlmBreakdown(
    account({ subentry_count: 1, num_sponsoring: 2 }),
  );

  expect(breakdown?.reserved).toBe("2.5");
});

test("entries someone else sponsors are not reserved here", () => {
  const breakdown = xlmBreakdown(
    account({ subentry_count: 4, num_sponsored: 4 }),
  );

  expect(breakdown?.reserved).toBe("1");
});

test("an account sponsored past its own base entries reserves nothing", () => {
  const breakdown = xlmBreakdown(account({ num_sponsored: 5 }));

  expect(breakdown?.reserved).toBe("0");
  expect(breakdown?.spendable).toBe("100");
});

test("selling liabilities are held back on top of the reserve", () => {
  const breakdown = xlmBreakdown(
    account({
      balances: [
        {
          balance: "100.0000000",
          asset_type: "native",
          selling_liabilities: "10.0000000",
        },
      ],
    }),
  );

  expect(breakdown?.liabilities).toBe("10");
  expect(breakdown?.spendable).toBe("89");
});

test("an account below its reserve is spendable zero, never negative", () => {
  const breakdown = xlmBreakdown(
    account({
      subentry_count: 10,
      balances: [{ balance: "1.0000000", asset_type: "native" }],
    }),
  );

  expect(breakdown?.spendable).toBe("0");
});

test("precision survives a balance a float would round", () => {
  const breakdown = xlmBreakdown(
    account({
      balances: [{ balance: "922337203685.4775807", asset_type: "native" }],
    }),
  );

  // grouped for reading, but every one of the seven decimals survives
  expect(breakdown?.total).toBe("922,337,203,685.4775807");
  expect(breakdown?.spendable).toBe("922,337,203,684.4775807");
});

test("a contract account with no XLM entry has no breakdown", () => {
  expect(xlmBreakdown(account({ balances: [] }))).toBeUndefined();
});

test("balances read XLM first, then by code, with pool shares last", () => {
  const balances: BalanceRecord[] = [
    { balance: "1", asset_type: "credit_alphanum4", asset_code: "USDC" },
    { balance: "2", asset_type: "liquidity_pool_shares" },
    { balance: "3", asset_type: "credit_alphanum4", asset_code: "KALE" },
    { balance: "4", asset_type: "native" },
  ];

  expect(
    sortedBalances(account({ balances })).map(
      (balance) => balance.asset_code ?? balance.asset_type,
    ),
  ).toEqual(["native", "KALE", "USDC", "liquidity_pool_shares"]);
});

test("only the flags an account turned on are listed", () => {
  expect(
    enabledFlags(
      account({
        flags: {
          auth_required: true,
          auth_revocable: false,
          auth_immutable: false,
          auth_clawback_enabled: true,
        },
      }),
    ),
  ).toEqual(["auth required", "clawback enabled"]);
});
