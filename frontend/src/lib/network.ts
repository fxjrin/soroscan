export type NetworkId = "mainnet" | "testnet";

export interface NetworkConfig {
  id: NetworkId;
  label: string;
  passphrase: string;
  horizonUrls: string[];
  rpcUrls: string[];
  /** soroscan's own index of contract invocations; empty = not indexed */
  indexerUrls: string[];
}

// URL order is the failover order; none of the public endpoints carry an SLA
export const NETWORKS: Record<NetworkId, NetworkConfig> = {
  mainnet: {
    id: "mainnet",
    label: "Mainnet",
    passphrase: "Public Global Stellar Network ; September 2015",
    horizonUrls: [
      "https://horizon.stellar.org",
      "https://horizon.stellar.lobstr.co",
    ],
    rpcUrls: [
      "https://mainnet.sorobanrpc.com",
      "https://rpc.ankr.com/stellar_soroban",
      "https://soroban-rpc.mainnet.stellar.gateway.fm",
      "https://stellar.api.onfinality.io/public",
    ],
    indexerUrls: ["https://api.soroscan.io"],
  },
  testnet: {
    id: "testnet",
    label: "Testnet",
    passphrase: "Test SDF Network ; September 2015",
    horizonUrls: ["https://horizon-testnet.stellar.org"],
    rpcUrls: ["https://soroban-testnet.stellar.org"],
    indexerUrls: [],
  },
};

export const DEFAULT_NETWORK: NetworkId = "mainnet";

// Etherscan pattern: bare domain = mainnet, testnet.* subdomain = testnet.
// The query param covers local dev and preview deploys without DNS.
export function resolveNetwork(hostname: string, search: string): NetworkId {
  if (hostname.startsWith("testnet.")) {
    return "testnet";
  }
  return new URLSearchParams(search).get("network") === "testnet"
    ? "testnet"
    : DEFAULT_NETWORK;
}

export const ACTIVE_NETWORK: NetworkId = resolveNetwork(
  window.location.hostname,
  window.location.search,
);

const usesSubdomain = window.location.hostname.startsWith("testnet.");

/**
 * Internal navigation target that keeps the selected network in the URL,
 * so a shared link always opens on the sender's network.
 */
export function appPath(path: string): string {
  if (ACTIVE_NETWORK === "testnet" && !usesSubdomain) {
    return path + (path.includes("?") ? "&" : "?") + "network=testnet";
  }
  return path;
}

export function networkToggleUrl(location: {
  hostname: string;
  pathname: string;
  search: string;
}): string {
  const target =
    resolveNetwork(location.hostname, location.search) === "mainnet"
      ? "testnet"
      : "mainnet";
  const params = new URLSearchParams(location.search);
  params.delete("network");
  if (location.hostname.endsWith("soroscan.io")) {
    const host = target === "testnet" ? "testnet.soroscan.io" : "soroscan.io";
    const query = params.toString();
    return `https://${host}${location.pathname}${query ? "?" + query : ""}`;
  }
  if (target === "testnet") {
    params.set("network", "testnet");
  }
  const query = params.toString();
  return `${location.pathname}${query ? "?" + query : ""}`;
}
