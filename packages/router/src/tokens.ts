/** Estimates token count for text the LLM never saw. Plug in an exact counter (e.g. `count_tokens`) via `RouterOptions`. */
export type TokenEstimator = (text: string) => number;

/** Heuristic: ~4 characters per token for English prose and code. Deterministic, dependency-free. */
export const estimateTokens: TokenEstimator = (text) => Math.ceil(text.length / 4);
