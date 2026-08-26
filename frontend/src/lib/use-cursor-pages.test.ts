import { act, renderHook } from "@testing-library/react";
import { expect, test } from "vitest";
import { useCursorPages } from "./use-cursor-pages";

test("the first page asks for no cursor", () => {
  const { result } = renderHook(() => useCursorPages());

  expect(result.current.cursor).toBeUndefined();
  expect(result.current.atStart).toBe(true);
  expect(result.current.depth).toBe(0);
});

test("each page forward carries the token it was opened with", () => {
  const { result } = renderHook(() => useCursorPages());

  act(() => result.current.next("100"));
  expect(result.current.cursor).toBe("100");

  act(() => result.current.next("200"));
  expect(result.current.cursor).toBe("200");
  expect(result.current.depth).toBe(2);
});

test("going back returns to the cursor of the page before, not to the start", () => {
  const { result } = renderHook(() => useCursorPages());

  act(() => result.current.next("100"));
  act(() => result.current.next("200"));
  act(() => result.current.back());

  expect(result.current.cursor).toBe("100");
  expect(result.current.atStart).toBe(false);
});

test("walking all the way back reaches the cursorless first page", () => {
  const { result } = renderHook(() => useCursorPages());

  act(() => result.current.next("100"));
  act(() => result.current.back());

  expect(result.current.cursor).toBeUndefined();
  expect(result.current.atStart).toBe(true);
});

test("reset drops the whole trail at once", () => {
  const { result } = renderHook(() => useCursorPages());

  act(() => result.current.next("100"));
  act(() => result.current.next("200"));
  act(() => result.current.reset());

  expect(result.current.cursor).toBeUndefined();
  expect(result.current.depth).toBe(0);
});
