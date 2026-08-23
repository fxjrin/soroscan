import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { App } from "./App";

test("renders the app shell", () => {
  render(<App />);
  expect(screen.getByText("Soroscan")).toBeDefined();
});
