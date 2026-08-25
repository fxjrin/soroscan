import { afterEach, expect, test } from "vitest";
import { canHighlight, highlightAddress } from "./address-highlight";

const G1 = "GADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOZPI";
const G2 = "GAEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSH7S";

function render(values: string[]) {
  document.body.innerHTML = values
    .map((value) => `<span data-address="${value}"></span>`)
    .join("");
}

function marked() {
  return [...document.querySelectorAll("[data-match]")].map((element) =>
    element.getAttribute("data-address"),
  );
}

afterEach(() => {
  document.body.innerHTML = "";
});

test("marks every occurrence of the hovered value and nothing else", () => {
  render([G1, G2, G1, G1]);

  highlightAddress(G1);

  expect(marked()).toEqual([G1, G1, G1]);
});

test("clearing the highlight leaves nothing marked", () => {
  render([G1, G2, G1]);

  highlightAddress(G1);
  highlightAddress(null);

  expect(marked()).toEqual([]);
});

test("moving to another value does not leave the previous one marked", () => {
  render([G1, G2, G1]);

  highlightAddress(G1);
  highlightAddress(G2);

  expect(marked()).toEqual([G2]);
});

test("a value that is not plain alphanumeric never reaches the selector", () => {
  render([G1]);
  // a hostile value would otherwise close the attribute selector and
  // match everything on the page
  const hostile = '"] , [data-address';

  expect(canHighlight(hostile)).toBe(false);
  expect(() => highlightAddress(hostile)).not.toThrow();
  expect(marked()).toEqual([]);
});
