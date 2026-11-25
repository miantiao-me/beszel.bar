export const ICON_NAMES = {
  server: "tabler:server",
  refresh: "ri:refresh-line",
  external: "ri:external-link-line",
  back: "ri:arrow-left-line",
  bell: "ri:notification-3-line",
  list: "ri:list-unordered",
  grid: "ri:layout-grid-line",
  clipboard: "ri:clipboard-line",
  check: "ri:check-line",
  alert: "ri:error-warning-line",
  trash: "ri:delete-bin-line",
} as const;

export type IconName = keyof typeof ICON_NAMES;

// Icon path from Tabler Icons (MIT).
export const SERVER_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v2a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3zm0 8a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v2a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3zm4-7v.01M7 16v.01"/></svg>';
