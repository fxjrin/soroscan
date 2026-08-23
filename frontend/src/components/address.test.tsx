import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { Address } from "./address";
import { UntrustedText } from "./untrusted-text";

const FULL = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";

afterEach(() => {
  vi.restoreAllMocks();
});

test("shows the truncated address with the full value for screen readers", () => {
  render(<Address value={FULL} />);

  expect(screen.getByText("GAAZ...CWN7")).toBeDefined();
  expect(screen.getByLabelText(FULL)).toBeDefined();
});

test("copy button writes the full value and announces it", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });

  render(<Address value={FULL} />);
  fireEvent.click(screen.getByRole("button", { name: "Copy full value" }));

  expect(await screen.findByText("Copied")).toBeDefined();
  expect(writeText).toHaveBeenCalledWith(FULL);
});

test("UntrustedText neutralizes bidi spoofing before rendering", () => {
  render(<UntrustedText value={"safe\u202Egnp.exe"} />);

  expect(screen.getByText("safe\uFFFDgnp.exe")).toBeDefined();
});
