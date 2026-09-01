import { useEffect } from "react";

export const DEFAULT_DESCRIPTION =
  "Explore Stellar and Soroban on-chain: transactions, accounts, assets, smart contracts, and ledgers, on mainnet and testnet.";

function upsertMeta(attr: "name" | "property", key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(
    `meta[${attr}="${key}"]`,
  );
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function upsertCanonical(href: string) {
  let el = document.head.querySelector<HTMLLinkElement>(
    'link[rel="canonical"]',
  );
  if (!el) {
    el = document.createElement("link");
    el.rel = "canonical";
    document.head.appendChild(el);
  }
  el.href = href;
}

function seoOrigin(): string {
  return window.location.hostname.startsWith("testnet.")
    ? "https://testnet.soroscan.io"
    : "https://soroscan.io";
}

/**
 * Sets the document title, description, canonical link, and social tags for
 * the current route. The app serves one static <head>, so each page keeps its
 * own metadata here for crawlers and link unfurlers that run javascript.
 */
export function useSeo(opts: {
  title: string;
  description?: string;
  noindex?: boolean;
}) {
  const { title, description = DEFAULT_DESCRIPTION, noindex = false } = opts;
  useEffect(() => {
    document.title = title;
    upsertMeta("name", "description", description);
    upsertMeta("property", "og:title", title);
    upsertMeta("property", "og:description", description);
    upsertMeta("name", "twitter:title", title);
    upsertMeta("name", "twitter:description", description);

    const url = seoOrigin() + window.location.pathname;
    upsertMeta("property", "og:url", url);
    upsertCanonical(url);

    if (noindex) {
      upsertMeta("name", "robots", "noindex");
      return () => {
        document.head.querySelector('meta[name="robots"]')?.remove();
      };
    }
  }, [title, description, noindex]);
}
