import { expect, test } from "vitest";
import { buildActivityRows, presentOperation } from "./activity";
import type { OperationRecord, TxRecord } from "./horizon/client";

const G1 = "GADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOZPI";
const G2 = "GAEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSH7S";
const C1 = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

// row building requires hex-64 hashes; short seeds expand deterministically
function fullHash(seed: string): string {
  return seed.length === 64 ? seed : seed.repeat(64).slice(0, 64);
}

function txRecord(hash: string, overrides?: Partial<TxRecord>): TxRecord {
  return {
    hash: fullHash(hash),
    paging_token: "100000000",
    successful: true,
    source_account: G1,
    operation_count: 1,
    created_at: "2026-08-24T09:00:00Z",
    fee_charged: "100",
    ...overrides,
  };
}

function opRecord(overrides: Partial<OperationRecord>): OperationRecord {
  return {
    id: "1",
    paging_token: "100000001",
    transaction_hash: fullHash("aa"),
    type: "payment",
    source_account: G1,
    ...overrides,
  };
}

test("payment maps parties, amount, and asset code", () => {
  const rows = buildActivityRows(
    [txRecord("aa")],
    [
      opRecord({
        type: "payment",
        from: G1,
        to: G2,
        amount: "12.5000000",
        asset_type: "native",
      }),
    ],
  );

  expect(rows[0].op).toMatchObject({
    label: "Payment",
    family: "transfer",
    from: G1,
    to: G2,
    amount: "12.5000000",
    assetCode: "XLM",
  });
});

test("credit asset uses its sanitized code", () => {
  const rows = buildActivityRows(
    [txRecord("aa")],
    [
      opRecord({
        type: "payment",
        from: G1,
        to: G2,
        amount: "3750.0000000",
        asset_type: "credit_alphanum4",
        asset_code: "US\u202EDC",
      }),
    ],
  );

  expect(rows[0].op?.assetCode).toBe("US\uFFFDDC");
});

test("create account maps funder to new account with starting balance", () => {
  const rows = buildActivityRows(
    [txRecord("aa")],
    [
      opRecord({
        type: "create_account",
        funder: G1,
        account: G2,
        starting_balance: "5.0000000",
      }),
    ],
  );

  expect(rows[0].op).toMatchObject({
    label: "Create account",
    from: G1,
    to: G2,
    amount: "5.0000000",
    assetCode: "XLM",
  });
});

const CONTRACT_SCVAL =
  "AAAAEgAAAAHXkotywnA8z+r365/0701QSlWouXn8m0UOoshCtNHOYQ==";
const TRANSFER_SCVAL = "AAAADwAAAAh0cmFuc2Zlcg==";
const INVOKE_FN = "HostFunctionTypeHostFunctionTypeInvokeContract";

test("contract call decodes target, function, and moved value", () => {
  const rows = buildActivityRows(
    [txRecord("aa")],
    [
      opRecord({
        type: "invoke_host_function",
        function: INVOKE_FN,
        address: "",
        parameters: [
          { type: "Address", value: CONTRACT_SCVAL },
          { type: "Sym", value: TRANSFER_SCVAL },
        ],
        asset_balance_changes: [
          {
            type: "transfer",
            from: G1,
            to: G2,
            amount: "479.0000000",
            asset_type: "native",
          },
        ],
      }),
    ],
  );

  expect(rows[0].op).toMatchObject({
    label: "Contract call",
    detail: "transfer",
    from: G1,
    to: C1,
    amount: "479.0000000",
    assetCode: "XLM",
  });
});

test("dex offers show the amount and asset being sold or bought", () => {
  const rows = buildActivityRows(
    [txRecord("aa"), txRecord("bb")],
    [
      opRecord({
        type: "manage_sell_offer",
        amount: "100.0000000",
        selling_asset_type: "credit_alphanum4",
        selling_asset_code: "USDC",
      }),
      opRecord({
        type: "manage_buy_offer",
        transaction_hash: fullHash("bb"),
        amount: "7.0000000",
        buying_asset_type: "native",
      }),
    ],
  );

  expect(rows[0].op).toMatchObject({
    amount: "100.0000000",
    assetCode: "USDC",
  });
  expect(rows[1].op).toMatchObject({ amount: "7.0000000", assetCode: "XLM" });
});

test("change trust points at the issuer being trusted", () => {
  const rows = buildActivityRows(
    [txRecord("aa")],
    [
      opRecord({
        type: "change_trust",
        trustor: G1,
        trustee: G2,
        asset_type: "credit_alphanum4",
        asset_code: "USDC",
      }),
    ],
  );

  expect(rows[0].op).toMatchObject({ from: G1, to: G2, assetCode: "USDC" });
});

test("contract call targets the invoked contract when horizon exposes it", () => {
  const rows = buildActivityRows(
    [txRecord("aa"), txRecord("bb")],
    [
      opRecord({
        type: "invoke_host_function",
        transaction_hash: fullHash("aa"),
        address: C1,
      }),
      opRecord({
        type: "invoke_host_function",
        transaction_hash: fullHash("bb"),
        address: "",
      }),
    ],
  );

  expect(rows[0].op).toMatchObject({
    label: "Contract call",
    family: "contract",
    from: G1,
    to: C1,
  });
  expect(rows[1].op?.to).toBeUndefined();
});

test("the earliest operation of a transaction is the primary one", () => {
  const rows = buildActivityRows(
    [txRecord("aa", { operation_count: 2 })],
    [
      opRecord({
        type: "manage_sell_offer",
        paging_token: "100000002",
      }),
      opRecord({
        type: "payment",
        paging_token: "100000001",
        from: G1,
        to: G2,
        amount: "1.0000000",
        asset_type: "native",
      }),
    ],
  );

  expect(rows[0].op?.label).toBe("Payment");
});

test("unknown operation types humanize instead of dropping the row", () => {
  const rows = buildActivityRows(
    [txRecord("aa")],
    [opRecord({ type: "some_future_op" })],
  );

  expect(rows[0].op).toMatchObject({
    label: "some future op",
    family: "other",
    from: G1,
  });
});

test("counterparty-less operations carry a destination hint", () => {
  const rows = buildActivityRows(
    [txRecord("aa"), txRecord("bb"), txRecord("cc"), txRecord("dd")],
    [
      opRecord({
        type: "manage_sell_offer",
        amount: "5.0000000",
        selling_asset_type: "native",
      }),
      opRecord({ type: "set_options", transaction_hash: fullHash("bb") }),
      opRecord({
        type: "invoke_host_function",
        transaction_hash: fullHash("cc"),
        address: "",
      }),
      opRecord({
        type: "create_claimable_balance",
        transaction_hash: fullHash("dd"),
        amount: "9.0000000",
        asset: "USDC:" + G2,
      }),
    ],
  );

  expect(rows[0].op?.toHint).toBe("order book");
  expect(rows[1].op?.toHint).toBe("own account");
  expect(rows[2].op?.toHint).toBe("contract");
  expect(rows[3].op).toMatchObject({
    toHint: "claimable balance",
    amount: "9.0000000",
    assetCode: "USDC",
  });
});

test("clawback flows from the holder back to the issuer", () => {
  const rows = buildActivityRows(
    [txRecord("aa")],
    [
      opRecord({
        type: "clawback",
        source_account: G2,
        from: G1,
        amount: "3.0000000",
        asset_type: "credit_alphanum4",
        asset_code: "USDC",
      }),
    ],
  );

  expect(rows[0].op).toMatchObject({ from: G1, to: G2, amount: "3.0000000" });
});

test("a transaction outside the operations window stays a plain row", () => {
  const rows = buildActivityRows(
    [txRecord("aa")],
    [opRecord({ transaction_hash: fullHash("zz") })],
  );

  expect(rows[0].op).toBeUndefined();
  expect(rows[0].tx.hash).toBe(fullHash("aa"));
});

test("malformed amounts are dropped, not rendered", () => {
  const rows = buildActivityRows(
    [txRecord("aa")],
    [
      opRecord({
        type: "payment",
        from: G1,
        to: G2,
        amount: "12,5 lumens",
        asset_type: "native",
      }),
    ],
  );

  expect(rows[0].op?.amount).toBeUndefined();
});

test("transactions with malformed hashes are dropped entirely", () => {
  const rows = buildActivityRows(
    [
      txRecord("gggg".repeat(16)),
      txRecord("ab\u202Ecd"),
      txRecord("beef".repeat(16)),
    ],
    [],
  );

  expect(rows).toHaveLength(1);
  expect(rows[0].tx.hash).toBe("beef".repeat(16));
});

test("asset codes longer than the protocol cap are rejected", () => {
  const rows = buildActivityRows(
    [txRecord("beef".repeat(16))],
    [
      opRecord({
        transaction_hash: "beef".repeat(16),
        type: "payment",
        from: G1,
        to: G2,
        amount: "1.0000000",
        asset_type: "credit_alphanum12",
        asset_code: "WAYTOOLONGCODE",
      }),
    ],
  );

  expect(rows[0].op?.assetCode).toBeUndefined();
});

test("a path payment carries both sides of the conversion", () => {
  const op = presentOperation({
    id: "1",
    paging_token: "1",
    transaction_hash: "abc",
    type: "path_payment_strict_send",
    source_account: G1,
    from: G1,
    to: G2,
    amount: "0.8488837",
    asset_type: "credit_alphanum4",
    asset_code: "PYUSD",
    source_amount: "5.0000000",
    source_asset_type: "native",
    path: [
      { asset_type: "credit_alphanum4", asset_code: "USDZ" },
      { asset_type: "credit_alphanum4", asset_code: "USDC" },
    ],
  });

  expect(op.sourceAmount).toBe("5.0000000");
  expect(op.sourceAssetCode).toBe("XLM");
  expect(op.assetCode).toBe("PYUSD");
  expect(op.hops).toBe(2);
  // two different assets is a swap, and the tag should say so
  expect(op.label).toBe("Swap");
});

test("a trustline carries the ceiling it sets", () => {
  const op = presentOperation({
    id: "1",
    paging_token: "1",
    transaction_hash: "abc",
    type: "change_trust",
    source_account: G1,
    trustor: G1,
    trustee: G2,
    asset_type: "credit_alphanum4",
    asset_code: "USDC",
    limit: "922337203685.4775807",
  });

  expect(op.assetCode).toBe("USDC");
  expect(op.to).toBe(G2);
  expect(op.limit).toBe("922337203685.4775807");
});

test("a retired trustline keeps its zero rather than losing it", () => {
  // zero is what retires the line, so it must survive as a value
  const op = presentOperation({
    id: "1",
    paging_token: "1",
    transaction_hash: "abc",
    type: "change_trust",
    source_account: G1,
    trustee: G2,
    asset_type: "credit_alphanum4",
    asset_code: "USDC",
    limit: "0",
  });

  expect(op.limit).toBe("0");
});

test("an offer names what it wants as well as what it gives", () => {
  const op = presentOperation({
    id: "1",
    paging_token: "1",
    transaction_hash: "abc",
    type: "manage_sell_offer",
    source_account: G1,
    amount: "26.5395094",
    price: "362.9500581",
    selling_asset_type: "native",
    buying_asset_type: "credit_alphanum4",
    buying_asset_code: "LMX",
  });

  expect(op.assetCode).toBe("XLM");
  expect(op.buyingAssetCode).toBe("LMX");
  expect(op.price).toBe("362.9500581");
});

test("a path payment in one asset is not labelled a swap", () => {
  const op = presentOperation({
    id: "1",
    paging_token: "1",
    transaction_hash: "abc",
    type: "path_payment_strict_send",
    source_account: G1,
    from: G1,
    to: G2,
    amount: "5.0000000",
    asset_type: "native",
    source_amount: "5.0000000",
    source_asset_type: "native",
  });

  expect(op.label).toBe("Path payment");
});
