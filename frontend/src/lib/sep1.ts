import { UpstreamError } from "@/lib/failover";

/**
 * One [[CURRENCIES]] entry of a stellar.toml, reduced to the fields the
 * explorer renders. Everything here is issuer-controlled input.
 */
export interface TomlCurrency {
  code?: string;
  issuer?: string;
  name?: string;
  image?: string;
  displayDecimals?: number;
}

// SEP-1 sizes the file itself at 100 KiB; reading past that means the
// domain is not serving a toml at all
const MAX_TOML_BYTES = 100 * 1024;
const FETCH_TIMEOUT_MS = 10_000;

const DOMAIN_SHAPE =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

/**
 * Fetches a domain's stellar.toml and returns its currency entries. The
 * domain comes from an issuer account's home_domain, so it is chain data:
 * anything that does not look like a public hostname is refused before a
 * request goes out.
 */
export async function fetchTomlCurrencies(
  domain: string,
  signal?: AbortSignal,
): Promise<TomlCurrency[]> {
  if (!DOMAIN_SHAPE.test(domain) || domain.length > 253) {
    throw new UpstreamError(`not a fetchable home domain: ${domain}`);
  }
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const response = await fetch(`https://${domain}/.well-known/stellar.toml`, {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) {
    throw new UpstreamError(`stellar.toml ${response.status} for ${domain}`);
  }
  const text = await response.text();
  if (text.length > MAX_TOML_BYTES) {
    throw new UpstreamError(`stellar.toml too large for ${domain}`);
  }
  return parseTomlCurrencies(text);
}

/** The entry describing one asset, matched by exact code and issuer. */
export function findCurrency(
  currencies: TomlCurrency[],
  code: string,
  issuer: string,
): TomlCurrency | undefined {
  return currencies.find(
    (currency) => currency.code === code && currency.issuer === issuer,
  );
}

/**
 * An image URL an <img> tag may load: https, and nothing else. Anything
 * more exotic an issuer writes into its toml is dropped, not repaired.
 */
export function sanitizeImageUrl(raw: string | undefined): string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return undefined;
  }
  return parsed.protocol === "https:" ? parsed.href : undefined;
}

/**
 * Pulls the [[CURRENCIES]] entries out of a stellar.toml with a tolerant
 * line parser. Real files disagree on spacing and quoting, and a strict
 * parser that throws on one malformed section would lose every valid
 * entry after it, so this reads the simple key-value lines it understands
 * and steps over everything else.
 */
export function parseTomlCurrencies(text: string): TomlCurrency[] {
  const currencies: TomlCurrency[] = [];
  let current: TomlCurrency | undefined;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("[")) {
      if (line.replace(/\s/g, "") === "[[CURRENCIES]]") {
        current = {};
        currencies.push(current);
      } else {
        current = undefined; // a different section ends the entry
      }
      continue;
    }
    if (current === undefined || line === "" || line.startsWith("#")) {
      continue;
    }
    const separator = line.indexOf("=");
    if (separator < 1) {
      continue;
    }
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = unquote(line.slice(separator + 1).trim());
    if (key === "code") {
      current.code = value;
    } else if (key === "issuer") {
      current.issuer = value;
    } else if (key === "name") {
      current.name = value;
    } else if (key === "image") {
      current.image = value;
    } else if (key === "display_decimals") {
      const decimals = Number(value);
      if (Number.isInteger(decimals) && decimals >= 0 && decimals <= 7) {
        current.displayDecimals = decimals;
      }
    }
  }
  return currencies.filter(
    (currency) => currency.code !== undefined && currency.issuer !== undefined,
  );
}

function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    if ((first === '"' || first === "'") && value.endsWith(first)) {
      return value.slice(1, -1);
    }
  }
  return value;
}
