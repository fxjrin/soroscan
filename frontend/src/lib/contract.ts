import { StrKey } from "@stellar/stellar-sdk/base";
import type {
  ScSpecFunctionV0,
  ScSpecTypeDef,
  ScSpecUdtErrorEnumV0,
} from "@stellar/stellar-sdk/xdr";
import { decodeScVal, type ScDisplay } from "@/lib/scval";

type Xdr = typeof import("@stellar/stellar-sdk/xdr");

function hexOf(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

/** The ledger key for a contract's own instance entry: its executable and instance storage. */
export async function contractInstanceKey(contractId: string): Promise<string> {
  const xdr: Xdr = await import("@stellar/stellar-sdk/xdr");
  const idBytes = StrKey.decodeContract(contractId);
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: xdr.ScAddress.scAddressTypeContract(
        new xdr.ContractId(idBytes),
      ),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent,
    }),
  ).toXdr("base64");
}

/** The ledger key for the wasm code stored under a hash, shared by every contract deployed from it. */
export async function contractCodeKey(wasmHashHex: string): Promise<string> {
  const xdr: Xdr = await import("@stellar/stellar-sdk/xdr");
  const bytes = new Uint8Array(wasmHashHex.length / 2);
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = parseInt(wasmHashHex.slice(index * 2, index * 2 + 2), 16);
  }
  return xdr.LedgerKey.contractCode(
    new xdr.LedgerKeyContractCode({ hash: bytes }),
  ).toXdr("base64");
}

export type ContractExecutable =
  { kind: "wasm"; wasmHash: string } | { kind: "stellarAsset" };

export interface ContractInstance {
  executable: ContractExecutable;
  /** the instance's own key/value storage; a contract's other storage
   * entries live under keys this cannot enumerate without already
   * knowing them */
  storage: Array<{ key: ScDisplay; value: ScDisplay }>;
}

const MAX_STORAGE_ENTRIES = 200; // a screenful many times over, bounds hostile instances

/**
 * Decodes a contract's instance entry from the raw ledger-entry XDR
 * `getLedgerEntries` returns. Chain data is untrusted input, so a
 * malformed entry yields undefined rather than throwing.
 */
export async function decodeContractInstance(
  dataXdr: string,
): Promise<ContractInstance | undefined> {
  try {
    const xdr: Xdr = await import("@stellar/stellar-sdk/xdr");
    const entry = xdr.LedgerEntryData.fromXdr(dataXdr, "base64");
    if (entry.type !== "contractData") {
      return undefined;
    }
    const val = entry.contractData.val;
    if (val.type !== "scvContractInstance") {
      return undefined;
    }
    const instance = val.instance;
    const executable =
      instance.executable.type === "contractExecutableWasm"
        ? {
            kind: "wasm" as const,
            wasmHash: hexOf(instance.executable.wasmHash.toBytes()),
          }
        : { kind: "stellarAsset" as const };
    const storage = (instance.storage ?? [])
      .slice(0, MAX_STORAGE_ENTRIES)
      .map((mapEntry) => ({
        key: decodeScVal(mapEntry.key.toXdr("base64")),
        value: decodeScVal(mapEntry.val.toXdr("base64")),
      }))
      .filter(
        (row): row is { key: ScDisplay; value: ScDisplay } =>
          row.key !== undefined && row.value !== undefined,
      );
    return { executable, storage };
  } catch {
    return undefined;
  }
}

export interface ContractCode {
  hash: string;
  wasmBytes: Uint8Array;
}

export async function decodeContractCode(
  dataXdr: string,
): Promise<ContractCode | undefined> {
  try {
    const xdr: Xdr = await import("@stellar/stellar-sdk/xdr");
    const entry = xdr.LedgerEntryData.fromXdr(dataXdr, "base64");
    if (entry.type !== "contractCode") {
      return undefined;
    }
    return {
      hash: hexOf(entry.contractCode.hash.toBytes()),
      wasmBytes: entry.contractCode.code,
    };
  } catch {
    return undefined;
  }
}

const MAX_SPEC_DEPTH = 8; // deeper than any real interface; bounds hostile recursion

// a spec type is a small recursive tree (Vec<T>, Option<T>, Map<K,V>...);
// this reads as the same kind of type signature a user would write by hand
function specTypeLabel(type: ScSpecTypeDef, depth: number): string {
  if (depth > MAX_SPEC_DEPTH) {
    return "...";
  }
  switch (type.type) {
    case "scSpecTypeVal":
      return "Val";
    case "scSpecTypeBool":
      return "bool";
    case "scSpecTypeVoid":
      return "void";
    case "scSpecTypeError":
      return "Error";
    case "scSpecTypeU32":
      return "u32";
    case "scSpecTypeI32":
      return "i32";
    case "scSpecTypeU64":
      return "u64";
    case "scSpecTypeI64":
      return "i64";
    case "scSpecTypeTimepoint":
      return "Timepoint";
    case "scSpecTypeDuration":
      return "Duration";
    case "scSpecTypeU128":
      return "u128";
    case "scSpecTypeI128":
      return "i128";
    case "scSpecTypeU256":
      return "u256";
    case "scSpecTypeI256":
      return "i256";
    case "scSpecTypeBytes":
      return "Bytes";
    case "scSpecTypeString":
      return "String";
    case "scSpecTypeSymbol":
      return "Symbol";
    case "scSpecTypeAddress":
      return "Address";
    case "scSpecTypeMuxedAddress":
      return "MuxedAddress";
    case "scSpecTypeOption":
      return `Option<${specTypeLabel(type.option.valueType, depth + 1)}>`;
    case "scSpecTypeResult":
      return `Result<${specTypeLabel(type.result.okType, depth + 1)}, ${specTypeLabel(type.result.errorType, depth + 1)}>`;
    case "scSpecTypeVec":
      return `Vec<${specTypeLabel(type.vec.elementType, depth + 1)}>`;
    case "scSpecTypeMap":
      return `Map<${specTypeLabel(type.map.keyType, depth + 1)}, ${specTypeLabel(type.map.valueType, depth + 1)}>`;
    case "scSpecTypeTuple":
      return `(${type.tuple.valueTypes.map((item) => specTypeLabel(item, depth + 1)).join(", ")})`;
    case "scSpecTypeBytesN":
      return `BytesN<${type.bytesN.n}>`;
    case "scSpecTypeUdt":
      return type.udt.name.toString();
    default:
      return "unknown";
  }
}

export interface ContractFunctionArg {
  name: string;
  type: string;
}

export interface ContractFunctionSpec {
  name: string;
  /** the function's own rustdoc comment, empty when it has none */
  doc: string;
  inputs: ContractFunctionArg[];
  outputs: string[];
}

function functionOf(spec: ScSpecFunctionV0): ContractFunctionSpec {
  return {
    name: spec.name.toString(),
    doc: spec.doc.toString(),
    inputs: spec.inputs.map((input) => ({
      name: input.name.toString(),
      type: specTypeLabel(input.type, 0),
    })),
    outputs: spec.outputs.map((output) => specTypeLabel(output, 0)),
  };
}

export interface ContractErrorCase {
  name: string;
  value: number;
  doc: string;
}

export interface ContractErrorEnum {
  name: string;
  doc: string;
  cases: ContractErrorCase[];
}

function errorEnumOf(entry: ScSpecUdtErrorEnumV0): ContractErrorEnum {
  return {
    name: entry.name.toString(),
    doc: entry.doc.toString(),
    cases: entry.cases.map((errorCase) => ({
      name: errorCase.name.toString(),
      value: errorCase.value,
      doc: errorCase.doc.toString(),
    })),
  };
}

export interface ContractInterfaceInfo {
  functions: ContractFunctionSpec[];
  errors: ContractErrorEnum[];
}

const MAX_FUNCTIONS = 200; // a screenful many times over, bounds hostile specs
const MAX_ERROR_ENUMS = 50;

/**
 * The functions a contract exposes and the errors it can raise, read from
 * the `contractspecv0` custom section the SDK's own parser finds in the
 * wasm. Undefined for wasm with no spec section, or wasm too malformed to
 * parse -- untrusted input, so this never throws.
 */
export async function contractInterface(
  wasmBytes: Uint8Array,
): Promise<ContractInterfaceInfo | undefined> {
  try {
    const { Spec } = await import("@stellar/stellar-sdk/contract");
    const parsed = Spec.fromWasm(wasmBytes);
    const functions = parsed.funcs().slice(0, MAX_FUNCTIONS).map(functionOf);
    const errors = parsed.entries
      .filter((entry) => entry.type === "scSpecEntryUdtErrorEnumV0")
      .slice(0, MAX_ERROR_ENUMS)
      .map((entry) => errorEnumOf(entry.udtErrorEnumV0));
    return { functions, errors };
  } catch {
    return undefined;
  }
}
