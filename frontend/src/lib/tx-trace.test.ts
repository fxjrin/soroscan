import { expect, test } from "vitest";
import {
  ContractDataDurability,
  ContractDataEntry,
  ContractEvent,
  ContractEventBody,
  ContractEventType,
  ContractEventV0,
  ContractId,
  DiagnosticEvent,
  ExtensionPoint,
  HostFunction,
  InvokeContractArgs,
  InvokeHostFunctionOp,
  LedgerEntry,
  LedgerEntryChange,
  LedgerEntryData,
  LedgerEntryExt,
  LedgerKey,
  LedgerKeyContractData,
  Memo,
  MuxedAccount,
  Operation,
  OperationBody,
  OperationMeta,
  Preconditions,
  ScAddress,
  ScVal,
  SorobanAuthorizationEntry,
  SorobanAuthorizedFunction,
  SorobanAuthorizedInvocation,
  SorobanCredentials,
  SorobanTransactionMeta,
  SorobanTransactionMetaExt,
  SorobanTransactionMetaExtV1,
  Transaction,
  TransactionEnvelope,
  TransactionExt,
  TransactionMeta,
  TransactionMetaV3,
  TransactionV1Envelope,
  TtlEntry,
} from "@stellar/stellar-sdk/xdr";
import { countTraceCalls, decodeTrace } from "./tx-trace";

const C1 = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const C1_BYTES = Uint8Array.from(
  atob("15KLcsJwPM/q9+uf9O9NUEpVqLl5/JtFDqLIQrTRzmE="),
  (char) => char.charCodeAt(0),
);

function ascii(value: string): Uint8Array {
  return Uint8Array.from(value, (char) => char.charCodeAt(0));
}

function sym(value: string): ScVal {
  return ScVal.scvSymbol(ascii(value));
}

function diagnostic(topics: ScVal[], data: ScVal): DiagnosticEvent {
  return new DiagnosticEvent({
    inSuccessfulContractCall: true,
    event: new ContractEvent({
      ext: ExtensionPoint.v0(),
      contractId: null,
      type: ContractEventType.diagnostic,
      body: ContractEventBody.v0(new ContractEventV0({ topics, data })),
    }),
  });
}

function fnCall(fn: string, args: ScVal[]): DiagnosticEvent {
  return diagnostic(
    [sym("fn_call"), ScVal.scvBytes(C1_BYTES), sym(fn)],
    ScVal.scvVec(args),
  );
}

function fnReturn(fn: string, value: ScVal): DiagnosticEvent {
  return diagnostic([sym("fn_return"), sym(fn)], value);
}

function contractEvent(name: string, data: ScVal): ContractEvent {
  return new ContractEvent({
    ext: ExtensionPoint.v0(),
    contractId: new ContractId(C1_BYTES),
    type: ContractEventType.contract,
    body: ContractEventBody.v0(
      new ContractEventV0({ topics: [sym(name)], data }),
    ),
  });
}

function metaOf(
  events: DiagnosticEvent[],
  contractEvents: ContractEvent[] = [],
  operations: OperationMeta[] = [],
): string {
  return TransactionMeta.v3(
    new TransactionMetaV3({
      ext: ExtensionPoint.v0(),
      txChangesBefore: [],
      operations,
      txChangesAfter: [],
      sorobanMeta: new SorobanTransactionMeta({
        ext: SorobanTransactionMetaExt.v0(),
        events: contractEvents,
        returnValue: ScVal.scvVoid(),
        diagnosticEvents: events,
      }),
    }),
  ).toXdr("base64");
}

function invocation(
  fn: string,
  subs: SorobanAuthorizedInvocation[],
): SorobanAuthorizedInvocation {
  return new SorobanAuthorizedInvocation({
    function: SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new InvokeContractArgs({
        contractAddress: ScAddress.scAddressTypeContract(
          new ContractId(C1_BYTES),
        ),
        functionName: ascii(fn),
        args: [],
      }),
    ),
    subInvocations: subs,
  });
}

function envelopeOf(auth: SorobanAuthorizationEntry[]): string {
  const operation = new Operation({
    sourceAccount: null,
    body: OperationBody.invokeHostFunction(
      new InvokeHostFunctionOp({
        hostFunction: HostFunction.hostFunctionTypeInvokeContract(
          new InvokeContractArgs({
            contractAddress: ScAddress.scAddressTypeContract(
              new ContractId(C1_BYTES),
            ),
            functionName: ascii("harvest"),
            args: [ScVal.scvU32(1)],
          }),
        ),
        auth,
      }),
    ),
  });
  const tx = new Transaction({
    sourceAccount: MuxedAccount.keyTypeEd25519(new Uint8Array(32).fill(7)),
    fee: 100,
    seqNum: 1n,
    cond: Preconditions.precondNone(),
    memo: Memo.memoNone(),
    operations: [operation],
    ext: TransactionExt.v0(),
  });
  return TransactionEnvelope.envelopeTypeTx(
    new TransactionV1Envelope({ tx, signatures: [] }),
  ).toXdr("base64");
}

test("builds the executed call tree from diagnostic events", async () => {
  const meta = metaOf([
    fnCall("harvest", [ScVal.scvU32(178651)]),
    fnCall("mint", [ScVal.scvU32(2)]),
    fnReturn("mint", ScVal.scvU32(9)),
    fnReturn("harvest", ScVal.scvVoid()),
  ]);
  const trace = await decodeTrace(meta, undefined);
  expect(trace?.source).toBe("diagnostics");
  expect(trace?.truncated).toBe(false);
  expect(trace?.calls).toHaveLength(1);
  const root = trace!.calls[0];
  expect(root.contract).toBe(C1);
  expect(root.fn).toBe("harvest");
  expect(root.args).toEqual([{ kind: "text", type: "u32", text: "178651" }]);
  expect(root.result).toBeUndefined(); // void returns stay silent
  expect(root.calls).toHaveLength(1);
  expect(root.calls[0].fn).toBe("mint");
  expect(root.calls[0].result).toEqual({
    kind: "text",
    type: "u32",
    text: "9",
  });
});

test("tolerates unbalanced streams and skips non-call events", async () => {
  const meta = metaOf([
    fnReturn("orphan", ScVal.scvU32(1)),
    diagnostic([sym("log")], ScVal.scvVoid()),
    fnCall("harvest", []),
  ]);
  const trace = await decodeTrace(meta, undefined);
  expect(trace?.calls).toHaveLength(1);
  expect(trace?.calls[0].fn).toBe("harvest");
});

test("falls back to the envelope auth tree when diagnostics are missing", async () => {
  const envelope = envelopeOf([
    new SorobanAuthorizationEntry({
      credentials: SorobanCredentials.sorobanCredentialsSourceAccount(),
      rootInvocation: invocation("harvest", [invocation("mint", [])]),
    }),
  ]);
  const trace = await decodeTrace(metaOf([]), envelope);
  expect(trace?.source).toBe("auth");
  const root = trace!.calls[0];
  expect(root.fn).toBe("harvest");
  expect(root.contract).toBe(C1);
  expect(root.args).toEqual([{ kind: "text", type: "u32", text: "1" }]);
  expect(root.calls).toHaveLength(1); // the repeated auth root is merged away
  expect(root.calls[0].fn).toBe("mint");
});

test("caps a hostile number of calls and reports the truncation", async () => {
  const events: DiagnosticEvent[] = [];
  for (let index = 0; index < 520; index++) {
    events.push(fnCall("spam", []), fnReturn("spam", ScVal.scvVoid()));
  }
  const trace = await decodeTrace(metaOf(events), undefined);
  expect(trace?.truncated).toBe(true);
  expect(trace?.calls).toHaveLength(500);
});

test("attaches a contract event to the call that raised it", async () => {
  const mintEvent = new DiagnosticEvent({
    inSuccessfulContractCall: true,
    event: contractEvent("mint", ScVal.scvU32(9)),
  });
  const meta = metaOf([
    fnCall("harvest", []),
    fnCall("mint", []),
    mintEvent,
    fnReturn("mint", ScVal.scvVoid()),
    fnReturn("harvest", ScVal.scvVoid()),
  ]);
  const trace = await decodeTrace(meta, undefined);
  const root = trace!.calls[0];
  expect(root.events).toHaveLength(0);
  expect(root.calls[0].events).toEqual([
    {
      contract: C1,
      topics: [{ kind: "text", type: "sym", text: "mint" }],
      data: { kind: "text", type: "u32", text: "9" },
      // it fired after both calls opened, which is what puts it below them
      seq: 2,
    },
  ]);
  expect(trace?.events).toHaveLength(0);
  expect(countTraceCalls(trace!.calls)).toBe(2);
});

test("without diagnostics the meta events surface unattributed", async () => {
  const meta = metaOf([], [contractEvent("mint", ScVal.scvU32(9))]);
  const trace = await decodeTrace(meta, undefined);
  expect(trace?.calls).toHaveLength(0);
  expect(trace?.events).toEqual([
    {
      contract: C1,
      topics: [{ kind: "text", type: "sym", text: "mint" }],
      data: { kind: "text", type: "u32", text: "9" },
      seq: 0,
    },
  ]);
});

test("collects contract data changes and ttl extensions from the meta", async () => {
  const addr = ScAddress.scAddressTypeContract(new ContractId(C1_BYTES));
  const dataEntry = (value: ScVal) =>
    new LedgerEntry({
      lastModifiedLedgerSeq: 1,
      data: LedgerEntryData.contractData(
        new ContractDataEntry({
          ext: ExtensionPoint.v0(),
          contract: addr,
          key: ScVal.scvSymbol(ascii("Pail")),
          durability: ContractDataDurability.temporary,
          val: value,
        }),
      ),
      ext: LedgerEntryExt.v0(),
    });
  const ttlEntry = new LedgerEntry({
    lastModifiedLedgerSeq: 1,
    data: LedgerEntryData.ttl(
      new TtlEntry({
        keyHash: new Uint8Array(32).fill(0xab),
        liveUntilLedgerSeq: 64121306,
      }),
    ),
    ext: LedgerEntryExt.v0(),
  });
  const operations = [
    new OperationMeta({
      changes: [
        LedgerEntryChange.ledgerEntryCreated(dataEntry(ScVal.scvU32(5))),
        LedgerEntryChange.ledgerEntryState(dataEntry(ScVal.scvU32(5))),
        LedgerEntryChange.ledgerEntryUpdated(ttlEntry),
        LedgerEntryChange.ledgerEntryRemoved(
          LedgerKey.contractData(
            new LedgerKeyContractData({
              contract: addr,
              key: ScVal.scvSymbol(ascii("Pail")),
              durability: ContractDataDurability.temporary,
            }),
          ),
        ),
      ],
    }),
  ];
  const trace = await decodeTrace(metaOf([], [], operations), undefined);
  expect(trace?.stateChanges).toEqual([
    {
      kind: "created",
      contract: C1,
      durability: "temporary",
      key: { kind: "text", type: "sym", text: "Pail" },
      value: { kind: "text", type: "u32", text: "5" },
    },
    {
      kind: "removed",
      contract: C1,
      durability: "temporary",
      key: { kind: "text", type: "sym", text: "Pail" },
      value: undefined,
    },
  ]);
  expect(trace?.ttlExtensions).toEqual([
    { keyHash: "ab".repeat(32), liveUntilLedger: 64121306 },
  ]);
});

test("names a ttl row's owner by hashing the touched ledger key", async () => {
  const addr = ScAddress.scAddressTypeContract(new ContractId(C1_BYTES));
  const pailKey = LedgerKey.contractData(
    new LedgerKeyContractData({
      contract: addr,
      key: ScVal.scvSymbol(ascii("Pail")),
      durability: ContractDataDurability.temporary,
    }),
  );
  const keyHash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", pailKey.toXdr() as never),
  );
  const operations = [
    new OperationMeta({
      changes: [
        LedgerEntryChange.ledgerEntryCreated(
          new LedgerEntry({
            lastModifiedLedgerSeq: 1,
            data: LedgerEntryData.contractData(
              new ContractDataEntry({
                ext: ExtensionPoint.v0(),
                contract: addr,
                key: ScVal.scvSymbol(ascii("Pail")),
                durability: ContractDataDurability.temporary,
                val: ScVal.scvU32(5),
              }),
            ),
            ext: LedgerEntryExt.v0(),
          }),
        ),
        LedgerEntryChange.ledgerEntryUpdated(
          new LedgerEntry({
            lastModifiedLedgerSeq: 1,
            data: LedgerEntryData.ttl(
              new TtlEntry({ keyHash, liveUntilLedgerSeq: 64121306 }),
            ),
            ext: LedgerEntryExt.v0(),
          }),
        ),
      ],
    }),
  ];
  const trace = await decodeTrace(metaOf([], [], operations), undefined);
  expect(trace?.ttlExtensions).toEqual([
    {
      keyHash: Array.from(keyHash, (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join(""),
      liveUntilLedger: 64121306,
      contract: C1,
      entry: "contract state",
    },
  ]);
});

test("collects core_metrics counters and the resource fee split", async () => {
  const metric = (name: string, value: bigint) =>
    diagnostic([sym("core_metrics"), sym(name)], ScVal.scvU64(value));
  const meta = TransactionMeta.v3(
    new TransactionMetaV3({
      ext: ExtensionPoint.v0(),
      txChangesBefore: [],
      operations: [],
      txChangesAfter: [],
      sorobanMeta: new SorobanTransactionMeta({
        ext: SorobanTransactionMetaExt.v1(
          new SorobanTransactionMetaExtV1({
            ext: ExtensionPoint.v0(),
            totalNonRefundableResourceFeeCharged: 46625n,
            totalRefundableResourceFeeCharged: 9727n,
            rentFeeCharged: 0n,
          }),
        ),
        events: [],
        returnValue: ScVal.scvVoid(),
        diagnosticEvents: [
          fnCall("harvest", []),
          fnReturn("harvest", ScVal.scvVoid()),
          metric("read_entry", 24n),
          metric("cpu_insn", 10274560n),
          metric("invoke_time_nsecs", 1323000n),
        ],
      }),
    }),
  ).toXdr("base64");
  const trace = await decodeTrace(meta, undefined);
  expect(trace?.metrics).toEqual({
    read_entry: "24",
    cpu_insn: "10274560",
    invoke_time_nsecs: "1323000",
  });
  expect(trace?.fees).toEqual({
    nonRefundable: "46625",
    refundable: "9727",
    rent: "0",
  });
});

test("garbage in both sources decodes to nothing", async () => {
  await expect(decodeTrace("AAAA", "not base64!!!")).resolves.toBeUndefined();
  await expect(decodeTrace(undefined, undefined)).resolves.toBeUndefined();
});

test("a frame's events and sub-calls keep the order they happened in", async () => {
  // the contract emits, then calls, then emits again: three siblings whose
  // order is only recoverable from the stream, not from their kind
  const meta = metaOf([
    fnCall("harvest", []),
    new DiagnosticEvent({
      inSuccessfulContractCall: true,
      event: contractEvent("before", ScVal.scvU32(1)),
    }),
    fnCall("mint", []),
    fnReturn("mint", ScVal.scvVoid()),
    new DiagnosticEvent({
      inSuccessfulContractCall: true,
      event: contractEvent("after", ScVal.scvU32(2)),
    }),
    fnReturn("harvest", ScVal.scvVoid()),
  ]);
  const trace = await decodeTrace(meta, undefined);
  const root = trace!.calls[0];

  const order = [
    ...root.events.map((event) => ({
      seq: event.seq,
      name: (event.topics[0] as { text: string }).text,
    })),
    ...root.calls.map((call) => ({ seq: call.seq, name: call.fn })),
  ]
    .sort((left, right) => left.seq - right.seq)
    .map((child) => child.name);

  expect(order).toEqual(["before", "mint", "after"]);
});
