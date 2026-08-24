import { useMemo } from "react";
import createStellarIdenticon from "stellar-identicon-js";
import { StrKey } from "@stellar/stellar-sdk/base";
import { cn } from "@/lib/utils";

function fallbackHue(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

// contracts and muxed accounts have no identicon standard yet, so their
// 32 payload bytes go through the account algorithm for an equally
// stable face per address
function identiconKey(address: string): string | null {
  try {
    if (address.startsWith("G")) {
      return address;
    }
    if (address.startsWith("C")) {
      return StrKey.encodeEd25519PublicKey(StrKey.decodeContract(address));
    }
    if (address.startsWith("M")) {
      return StrKey.encodeEd25519PublicKey(
        StrKey.decodeMed25519PublicKey(address).slice(0, 32),
      );
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * SEP-33 identicon: the same account renders the same face here as in
 * Lobstr and StellarExpert. Contract and muxed addresses get a pixel
 * face derived from their payload bytes; garbage falls back to a
 * deterministic color chip.
 */
export function Identicon({
  address,
  size = 18,
  className,
}: {
  address: string;
  size?: number;
  className?: string;
}) {
  const dataUrl = useMemo(() => {
    const key = identiconKey(address);
    if (key === null) {
      return null;
    }
    try {
      return createStellarIdenticon(key).toDataURL();
    } catch {
      return null; // invalid key or no canvas support (jsdom)
    }
  }, [address]);

  if (!dataUrl) {
    return (
      <span
        className={cn("inline-block shrink-0 rounded-[2px]", className)}
        style={{
          width: size,
          height: size,
          background: `hsl(${fallbackHue(address)} 55% 55%)`,
        }}
        aria-hidden="true"
      />
    );
  }

  return (
    <img
      src={dataUrl}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      className={cn("shrink-0 rounded-[2px]", className)}
      style={{ imageRendering: "pixelated" }}
    />
  );
}
