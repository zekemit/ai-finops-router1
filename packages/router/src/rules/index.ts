import type { OffloadRule } from "../types";
import { grepSearchRule } from "./grep-search";
import { jsonFormatRule } from "./json-format";
import { lintCheckRule } from "./lint-check";
import { testSummaryRule } from "./test-summary";

/** Evaluated in this order; the first rule to match wins. */
export const DEFAULT_RULES: readonly OffloadRule[] = [jsonFormatRule, testSummaryRule, lintCheckRule, grepSearchRule];

export { grepSearchRule, jsonFormatRule, lintCheckRule, testSummaryRule };
