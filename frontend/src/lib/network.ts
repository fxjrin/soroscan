export type NetworkId = "mainnet" | "testnet";

export interface NetworkConfig {
  id: NetworkId;
  label: string;
  passphrase: string;
  horizonUrls: string[];
  rpcUrls: string[];
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
  },
  testnet: {
    id: "testnet",
    label: "Testnet",
    passphrase: "Test SDF Network ; September 2015",
    horizonUrls: ["https://horizon-testnet.stellar.org"],
    rpcUrls: ["https://soroban-testnet.stellar.org"],
  },
};

export const DEFAULT_NETWORK: NetworkId = "mainnet";
