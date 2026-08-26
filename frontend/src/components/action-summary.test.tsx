import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { expect, test } from "vitest";
import { ActionSummary } from "./action-summary";
import { TooltipProvider } from "./ui/tooltip";
import { presentOperation } from "@/lib/activity";
import type { OperationRecord } from "@/lib/horizon/client";

const G1 = "GADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOZPI";
const G2 = "GAEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSH7S";

// an address inside the sentence links and carries a tooltip, so the
// providers the app mounts at the root have to be here too
function sentenceOf(op: Partial<OperationRecord>): string {
  const record: OperationRecord = {
    id: "1",
    paging_token: "1",
    transaction_hash: "abc",
    source_account: G1,
    type: "payment",
    ...op,
  };
  render(
    <MemoryRouter>
      <TooltipProvider>
        <ActionSummary op={presentOperation(record)} />
      </TooltipProvider>
    </MemoryRouter>,
  );
  return screen.getByRole("paragraph").textContent ?? "";
}

test("a swap says what went in and what came out", () => {
  expect(
    sentenceOf({
      type: "path_payment_strict_send",
      from: G1,
      to: G1,
      source_amount: "5.0000000",
      source_asset_type: "native",
      amount: "0.8488837",
      asset_type: "credit_alphanum4",
      asset_code: "PYUSD",
      path: [{ asset_type: "credit_alphanum4", asset_code: "USDC" }],
    }),
  ).toContain("swapped 5 XLM for 0.84888 PYUSD via 1 hop");
});

test("a conversion that lands on somebody else names them", () => {
  expect(
    sentenceOf({
      type: "path_payment_strict_receive",
      from: G1,
      to: G2,
      source_amount: "5.0000000",
      source_asset_type: "native",
      amount: "1.0000000",
      asset_type: "credit_alphanum4",
      asset_code: "USDC",
    }),
  ).toContain("swapped 5 XLM for 1 USDC to");
});

test("a path payment in one asset is still a payment", () => {
  // same asset on both sides converts nothing, whatever route it took
  expect(
    sentenceOf({
      type: "path_payment_strict_send",
      from: G1,
      to: G2,
      source_amount: "5.0000000",
      source_asset_type: "native",
      amount: "5.0000000",
      asset_type: "native",
    }),
  ).toContain("sent 5 XLM to");
});

test("a trustline says the asset, the issuer, and the ceiling", () => {
  expect(
    sentenceOf({
      type: "change_trust",
      trustor: G1,
      trustee: G2,
      asset_type: "credit_alphanum4",
      asset_code: "USDC",
      limit: "1000.0000000",
    }),
  ).toContain("trusted USDC up to 1,000");
});

test("a zero ceiling reads as retiring the line, not as trusting zero", () => {
  expect(
    sentenceOf({
      type: "change_trust",
      trustor: G1,
      trustee: G2,
      asset_type: "credit_alphanum4",
      asset_code: "USDC",
      limit: "0",
    }),
  ).toContain("removed the USDC trustlineissued by");
});

test("a pool share trustline has no issuer to name", () => {
  expect(
    sentenceOf({
      type: "change_trust",
      trustor: G1,
      asset_type: "liquidity_pool_shares",
      limit: "1000.0000000",
    }),
  ).toContain("trusted a pool share up to 1,000");
});

test("a sell offer names both sides and the rate", () => {
  expect(
    sentenceOf({
      type: "manage_sell_offer",
      amount: "26.5395094",
      price: "362.9500581",
      selling_asset_type: "native",
      buying_asset_type: "credit_alphanum4",
      buying_asset_code: "LMX",
    }),
  ).toContain("offered 26.5395 XLM for LMX at 362.95005");
});

test("a buy offer reads from the buyer's side", () => {
  expect(
    sentenceOf({
      type: "manage_buy_offer",
      amount: "100.0000000",
      price: "0.5000000",
      buying_asset_type: "credit_alphanum4",
      buying_asset_code: "USDC",
      selling_asset_type: "native",
    }),
  ).toContain("offered to buy 100 USDC with XLM at 0.5");
});

test("an operation with nothing decodable still says its kind", () => {
  expect(sentenceOf({ type: "bump_sequence" })).toContain(
    "performed bump sequence",
  );
});
