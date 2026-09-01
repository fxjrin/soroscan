export type NetworkId = "mainnet" | "testnet" | "futurenet";

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
  futurenet: {
    id: "futurenet",
    label: "Futurenet",
    passphrase: "Test SDF Future Network ; October 2022",
    horizonUrls: ["https://horizon-futurenet.stellar.org"],
    rpcUrls: ["https://rpc-futurenet.stellar.org"],
    indexerUrls: [],
  },
};

export const DEFAULT_NETWORK: NetworkId = "mainnet";

// Etherscan pattern: bare domain = mainnet, a network.* subdomain otherwise.
// The query param covers local dev and preview deploys without DNS.
const SUBDOMAIN_HOSTS: Record<NetworkId, string> = {
  mainnet: "soroscan.io",
  testnet: "testnet.soroscan.io",
  futurenet: "futurenet.soroscan.io",
};

export function resolveNetwork(hostname: string, search: string): NetworkId {
  if (hostname.startsWith("testnet.")) return "testnet";
  if (hostname.startsWith("futurenet.")) return "futurenet";
  const param = new URLSearchParams(search).get("network");
  if (param === "testnet" || param === "futurenet") return param;
  return DEFAULT_NETWORK;
}

export const ACTIVE_NETWORK: NetworkId = resolveNetwork(
  window.location.hostname,
  window.location.search,
);

const onNetworkSubdomain =
  window.location.hostname.startsWith("testnet.") ||
  window.location.hostname.startsWith("futurenet.");

/**
 * Internal navigation target that keeps the selected network in the URL,
 * so a shared link always opens on the sender's network.
 */
export function appPath(path: string): string {
  if (ACTIVE_NETWORK !== DEFAULT_NETWORK && !onNetworkSubdomain) {
    return (
      path + (path.includes("?") ? "&" : "?") + `network=${ACTIVE_NETWORK}`
    );
  }
  return path;
}

/**
 * URL that opens the current page on `target`: a dedicated subdomain in
 * production, a query param for local dev and preview deploys.
 */
export function networkUrl(
  location: { hostname: string; pathname: string; search: string },
  target: NetworkId,
): string {
  const params = new URLSearchParams(location.search);
  params.delete("network");
  if (location.hostname.endsWith("soroscan.io")) {
    const query = params.toString();
    return `https://${SUBDOMAIN_HOSTS[target]}${location.pathname}${query ? "?" + query : ""}`;
  }
  if (target !== DEFAULT_NETWORK) {
    params.set("network", target);
  }
  const query = params.toString();
  return `${location.pathname}${query ? "?" + query : ""}`;
}
