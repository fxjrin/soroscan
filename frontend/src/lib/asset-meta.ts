import { useQuery } from "@tanstack/react-query";
import { fetchAssetMeta, indexerAvailable } from "@/lib/indexer/client";
import { ACTIVE_NETWORK, appPath } from "@/lib/network";

// the native asset has no issuer account and no stellar.toml to resolve
const NATIVE_META = {
  name: "Stellar Lumens",
  description:
    "The native asset of the Stellar network, defined by the protocol itself.",
  domain: "stellar.org",
  icon: true,
};

export function isNativeAsset(code: string, issuer?: string): boolean {
  // an issued asset can also call itself XLM; only the issuerless one is real
  return code === "XLM" && issuer === undefined;
}

export function assetPath(code: string, issuer?: string): string {
  return appPath(
    issuer === undefined ? "/asset/XLM" : `/asset/${code}-${issuer}`,
  );
}

/**
 * Issuer-published identity for an asset, from the soroscan proxy. The
 * native asset answers immediately; everything else resolves in the
 * background and pages render without it first.
 */
export function useAssetMeta(code: string, issuer?: string) {
  const { data } = useQuery({
    queryKey: ["asset-meta", ACTIVE_NETWORK, code, issuer],
    queryFn: ({ signal }) =>
      fetchAssetMeta(ACTIVE_NETWORK, code, issuer ?? "", signal),
    enabled: issuer !== undefined && indexerAvailable(ACTIVE_NETWORK),
    staleTime: 60 * 60 * 1000, // the proxy itself re-resolves hourly at most
  });
  if (isNativeAsset(code, issuer)) {
    return NATIVE_META;
  }
  return data ?? undefined;
}
