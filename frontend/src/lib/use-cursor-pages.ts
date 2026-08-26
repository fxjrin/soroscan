import { useCallback, useState } from "react";

export interface CursorPages {
  /** the cursor for the page on screen; absent on the first page */
  cursor?: string;
  /** how many pages back the reader has walked, for a "page 3" style label */
  depth: number;
  atStart: boolean;
  /** @param token - the paging token of the last record on the current page */
  next: (token: string) => void;
  back: () => void;
  reset: () => void;
}

/**
 * Walks a Horizon collection a page at a time. Horizon pages by cursor, not
 * by offset, so going back means remembering the cursor of every page on the
 * way rather than subtracting from a page number.
 */
export function useCursorPages(): CursorPages {
  const [visited, setVisited] = useState<string[]>([]);

  const next = useCallback((token: string) => {
    setVisited((pages) => [...pages, token]);
  }, []);

  const back = useCallback(() => {
    setVisited((pages) => pages.slice(0, -1));
  }, []);

  const reset = useCallback(() => {
    setVisited([]);
  }, []);

  return {
    cursor: visited[visited.length - 1],
    depth: visited.length,
    atStart: visited.length === 0,
    next,
    back,
    reset,
  };
}
