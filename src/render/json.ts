import type { Report } from "../types.js";

/** Stable JSON: fixed key order comes from object construction; arrays are pre-sorted by the scanner. */
export function renderJson(report: Report): string {
  return JSON.stringify(report, null, 2) + "\n";
}
