export const MOBILE_LAYOUT_MAX_WIDTH = 860;

export function isMobileLayout(width: number): boolean {
  return width <= MOBILE_LAYOUT_MAX_WIDTH;
}

export function shouldAutoHideSidebar(
  previousWidth: number,
  nextWidth: number,
): boolean {
  return !isMobileLayout(previousWidth) && isMobileLayout(nextWidth);
}
