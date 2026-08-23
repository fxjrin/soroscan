import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});

// jsdom has no EventSource; a inert stand-in keeps stream consumers renderable
class StubEventSource {
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  close() {}
}

if (typeof globalThis.EventSource === "undefined") {
  globalThis.EventSource = StubEventSource as unknown as typeof EventSource;
}
