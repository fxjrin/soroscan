import { expect, test } from "vitest";
import { netBalanceChanges, operationIdOf } from "./balance-changes";
import type { EffectRecord } from "./horizon/client";

const G1 = "GADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOZPI";
const G2 = "GAEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSH7S";
const KALE = "GBDVX4VELCDSQ54KQJYTNHXAHFLBCA77ZY2USQBM4CSHTTV7DME7KALE";
const OTHER = "GBEUJWAVFYLJZKTQTZHUPQE3PZBWSTRIRRWLIVCAJNL5FUEIIUYVJZ7F";

function credit(account: string, amount: string, issuer = KALE): EffectRecord {
  return {
    id: `${account}-${amount}-c`,
    type: "account_credited",
    account,
    amount,
    asset_type: "credit_alphanum4",
    asset_code: "KALE",
    asset_issuer: issuer,
  };
}

function debit(account: string, amount: string): EffectRecord {
  return {
    id: `${account}-${amount}-d`,
    type: "account_debited",
    account,
    amount,
    asset_type: "native",
  };
}

test("adds up the many small credits a payout splits into", () => {
  const effects = [
    credit(G1, "0.9859848"),
    credit(G1, "0.9627242"),
    credit(G1, "1.1568700"),
  ];

  expect(netBalanceChanges(effects)).toEqual([
    { holder: G1, assetCode: "KALE", assetIssuer: KALE, amount: "3.105579" },
  ]);
});

test("credits and debits of one asset settle into a signed total", () => {
  const effects = [debit(G1, "12.5000000"), debit(G1, "0.5000000")];

  expect(netBalanceChanges(effects)).toEqual([
    { holder: G1, assetCode: "XLM", assetIssuer: undefined, amount: "-13" },
  ]);
});

test("an asset that only passed through leaves no row", () => {
  const effects = [
    { ...credit(G1, "5.0000000"), id: "in" },
    {
      ...debit(G1, "5.0000000"),
      id: "out",
      asset_type: "credit_alphanum4",
      asset_code: "KALE",
      asset_issuer: KALE,
    },
  ];

  expect(netBalanceChanges(effects)).toEqual([]);
});

test("the same code from a different issuer is a different asset", () => {
  const effects = [credit(G1, "1.0000000"), credit(G1, "2.0000000", OTHER)];

  expect(netBalanceChanges(effects)).toEqual([
    { holder: G1, assetCode: "KALE", assetIssuer: KALE, amount: "1" },
    { holder: G1, assetCode: "KALE", assetIssuer: OTHER, amount: "2" },
  ]);
});

test("each account keeps its own total", () => {
  const effects = [credit(G1, "1.0000000"), credit(G2, "2.5000000")];

  expect(netBalanceChanges(effects).map((c) => c.amount)).toEqual(["1", "2.5"]);
});

test("precision survives amounts a float would round", () => {
  const effects = [credit(G1, "0.0000001"), credit(G1, "0.0000002")];

  expect(netBalanceChanges(effects)[0].amount).toBe("0.0000003");
});

test("effects that are not balance movements are ignored", () => {
  const effects: EffectRecord[] = [
    { id: "1", type: "trustline_created", account: G1 },
    { id: "2", type: "account_credited", account: G1, amount: "not a number" },
    credit(G1, "1.0000000"),
  ];

  expect(netBalanceChanges(effects)).toEqual([
    { holder: G1, assetCode: "KALE", assetIssuer: KALE, amount: "1" },
  ]);
});

test("a contract effect belongs to the contract, not to the caller", () => {
  // Horizon repeats the calling account on every contract effect, so the
  // contract field is the only thing that says whose balance moved
  const router = "CAS5PJYZQ74Z7W3YO24J6MX47WG6UFY52Z4JESCAE5I4COZFPAN664B3";
  const effects: EffectRecord[] = [
    {
      id: "1",
      type: "contract_credited",
      account: G1,
      contract: router,
      amount: "5.9039710",
      asset_type: "native",
    },
    {
      id: "2",
      type: "account_debited",
      account: G1,
      amount: "5.9039710",
      asset_type: "native",
    },
  ];

  expect(netBalanceChanges(effects)).toEqual([
    {
      holder: router,
      assetCode: "XLM",
      assetIssuer: undefined,
      amount: "5.903971",
    },
    {
      holder: G1,
      assetCode: "XLM",
      assetIssuer: undefined,
      amount: "-5.903971",
    },
  ]);
});

test("reads the source operation out of the effect link", () => {
  expect(
    operationIdOf({
      id: "1",
      type: "account_credited",
      _links: {
        operation: {
          href: "https://horizon.stellar.org/operations/2753251891",
        },
      },
    }),
  ).toBe("2753251891");
});

test("an effect without a usable operation link resolves to nothing", () => {
  expect(operationIdOf({ id: "1", type: "account_credited" })).toBeUndefined();
  expect(
    operationIdOf({
      id: "1",
      type: "account_credited",
      _links: {
        operation: { href: "https://horizon.stellar.org/operations/" },
      },
    }),
  ).toBeUndefined();
});
