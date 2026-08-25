import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import { Address } from "./address";
import { TooltipProvider } from "./ui/tooltip";
import { UntrustedText } from "./untrusted-text";

const FULL = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";

// the app mounts these at the root; an address carries a tooltip and
// links to the entity page, so it needs both to render
function renderAddress(node: React.ReactNode) {
  return render(
    <MemoryRouter>
      <TooltipProvider>{node}</TooltipProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

test("shows the truncated address with the full value for screen readers", () => {
  renderAddress(<Address value={FULL} />);

  expect(screen.getByText("GAAZ...CWN7")).toBeDefined();
  expect(screen.getByLabelText(FULL)).toBeDefined();
});

test("copy button writes the full value and announces it", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });

  renderAddress(<Address value={FULL} />);
  fireEvent.click(screen.getByRole("button", { name: "Copy full value" }));

  expect(await screen.findByText("Copied")).toBeDefined();
  expect(writeText).toHaveBeenCalledWith(FULL);
});

test("UntrustedText neutralizes bidi spoofing before rendering", () => {
  render(<UntrustedText value={"safe\u202Egnp.exe"} />);

  expect(screen.getByText("safe\uFFFDgnp.exe")).toBeDefined();
});
