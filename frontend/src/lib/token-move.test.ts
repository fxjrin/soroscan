import { expect, test } from "vitest";
import { tokenMove } from "./token-move";
import type { TraceEvent } from "./tx-trace";

const FROM = "GADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOZPI";
const TO = "CAS5PJYZQ74Z7W3YO24J6MX47WG6UFY52Z4JESCAE5I4COZFPAN664B3";
const ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

function event(
  topics: TraceEvent["topics"],
  data?: TraceEvent["data"],
): TraceEvent {
  return { topics, data, seq: 0 };
}

const sym = (text: string) => ({ kind: "text" as const, type: "sym", text });
const str = (text: string) => ({ kind: "text" as const, type: "str", text });
const address = (value: string) => ({
  kind: "address" as const,
  type: "address" as const,
  address: value,
});
const i128 = (text: string) => ({ kind: "text" as const, type: "i128", text });

test("a transfer names both sides and the asset", () => {
  expect(
    tokenMove(
      event(
        [sym("transfer"), address(FROM), address(TO), str("native")],
        i128("59039710"),
      ),
    ),
  ).toEqual({ from: FROM, to: TO, amount: "5.903971", code: "XLM" });
});

test("a credit asset keeps its code and drops the issuer", () => {
  expect(
    tokenMove(
      event(
        [sym("transfer"), address(FROM), address(TO), str(`USDC:${ISSUER}`)],
        i128("10000000"),
      ),
    )?.code,
  ).toBe("USDC");
});

test("a mint has a receiver and no sender", () => {
  const move = tokenMove(
    event([sym("mint"), address(TO), str("native")], i128("10000000")),
  );

  expect(move?.from).toBeUndefined();
  expect(move?.to).toBe(TO);
});

test("a burn has a sender and no receiver", () => {
  const move = tokenMove(
    event([sym("burn"), address(FROM), str("native")], i128("10000000")),
  );

  expect(move?.from).toBe(FROM);
  expect(move?.to).toBeUndefined();
});

test("precision survives an amount a float would round", () => {
  expect(
    tokenMove(
      event(
        [sym("transfer"), address(FROM), address(TO), str("native")],
        i128("922337203685477580"),
      ),
    )?.amount,
  ).toBe("92,233,720,368.547758");
});

test("an event of another shape moves nothing this can vouch for", () => {
  expect(
    tokenMove(event([sym("swap"), address(FROM)], i128("1"))),
  ).toBeUndefined();
});

test("a transfer whose amount is not a number moves nothing", () => {
  expect(
    tokenMove(
      event([sym("transfer"), address(FROM), address(TO)], sym("not a number")),
    ),
  ).toBeUndefined();
});

test("a transfer with no addresses at all moves nothing", () => {
  expect(
    tokenMove(event([sym("transfer"), sym("nope")], i128("1"))),
  ).toBeUndefined();
});
