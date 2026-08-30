import { afterEach, expect, test } from "vitest";
import { activeTheme, applyTheme } from "./theme";

afterEach(() => {
  document.documentElement.classList.remove("dark");
  localStorage.removeItem("theme");
});

test("applying a theme sets the class and remembers the choice", () => {
  applyTheme("dark");
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  expect(localStorage.getItem("theme")).toBe("dark");
  expect(activeTheme()).toBe("dark");

  applyTheme("light");
  expect(document.documentElement.classList.contains("dark")).toBe(false);
  expect(localStorage.getItem("theme")).toBe("light");
  expect(activeTheme()).toBe("light");
});
