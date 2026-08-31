// an asset key is a code, or a code and its issuer strkey: both alphabets
// are alphanumeric, so the key never carries a character that could break
// out of the attribute selector it is spliced into
const KEY_SHAPE = /^[A-Za-z0-9:]+$/;

export function assetKey(code: string, issuer?: string): string {
  return issuer === undefined ? code : `${code}:${issuer}`;
}

/**
 * Marks every mention of one asset on the page so a reader can see the
 * same token in another row at a glance. The mark is a data attribute
 * React never writes, so a re-render cannot clear it, and it carries no
 * meaning for assistive technology: each mention already names the asset.
 */
export function highlightAsset(key: string | null): void {
  for (const marked of document.querySelectorAll(
    "[data-asset][data-asset-match]",
  )) {
    marked.removeAttribute("data-asset-match");
  }
  if (key === null || !KEY_SHAPE.test(key)) {
    return;
  }
  for (const match of document.querySelectorAll(`[data-asset="${key}"]`)) {
    match.setAttribute("data-asset-match", "");
  }
}
