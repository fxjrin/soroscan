import type { Page } from "@playwright/test";

export const RPC_PROVIDERS = [
  "https://mainnet.sorobanrpc.com/**",
  "https://rpc.ankr.com/**",
  "https://soroban-rpc.mainnet.stellar.gateway.fm/**",
  "https://stellar.api.onfinality.io/**",
];

// the public ledger archive, the only source of diagnostic events for a
// transaction older than RPC retention
export const LEDGER_ARCHIVE =
  "https://aws-public-blockchain.s3.amazonaws.com/**";

export const HORIZON_PROVIDERS = [
  "https://horizon.stellar.org/**",
  "https://horizon.stellar.lobstr.co/**",
];

// the bare https catch-all has been observed leaking real requests, so
// every live host the app knows also gets an explicit abort; specs
// register their own fulfilling routes afterwards, which take precedence
export async function blockLiveHosts(page: Page) {
  await page.route("https://**", (route) => route.abort());
  for (const pattern of [
    ...HORIZON_PROVIDERS,
    ...RPC_PROVIDERS,
    LEDGER_ARCHIVE,
  ]) {
    await page.route(pattern, (route) => route.abort());
  }
}
