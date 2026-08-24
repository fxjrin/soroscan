let offsetMs = 0;
let initialized = false;

const MAX_PLAUSIBLE_SKEW_MS = 120_000;
const HEADER_TRUNCATION_MS = 500; // Date headers truncate to the second
const SMOOTHING = 0.2;

/**
 * Samples the server clock from a response Date header (Horizon exposes
 * it via CORS), corrected by half the round trip. A smoothed offset
 * turns the local clock into chain time, so ages stay honest even when
 * the user's clock is skewed.
 */
export function recordClockSample(serverDateHeader: string, rttMs: number) {
  const server = Date.parse(serverDateHeader);
  if (Number.isNaN(server)) {
    return;
  }
  const sample =
    server + HEADER_TRUNCATION_MS + Math.min(rttMs, 2000) / 2 - Date.now();
  if (Math.abs(sample) > MAX_PLAUSIBLE_SKEW_MS) {
    return;
  }
  offsetMs = initialized
    ? offsetMs * (1 - SMOOTHING) + sample * SMOOTHING
    : sample;
  initialized = true;
}

export function chainNow(): number {
  return Date.now() + offsetMs;
}

export function resetClock() {
  offsetMs = 0;
  initialized = false;
}
