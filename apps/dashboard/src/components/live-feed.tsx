import { formatInt, formatPct, formatUsd } from "@ai-finops/interceptor";
import { Ban, OctagonAlert, Zap } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import type { FeedItem } from "../lib/engine";
import { AGENT_COLOR, AGENT_NAME, RULE_NAME, modelLabel } from "../lib/labels";

function Row({ item, animate }: { item: FeedItem; animate: boolean }) {
  let icon: ReactNode = null;
  let meta = "";
  let amount: ReactNode = null;
  let tint = "var(--ink)";

  switch (item.kind) {
    case "llm":
      meta = `${AGENT_NAME[item.agent]} asked ${modelLabel(item.model ?? "")}, ${formatPct(item.cacheHitRate ?? 0)} read from cache`;
      amount = <span className="num">{formatUsd(item.usd)}</span>;
      break;
    case "offload":
      icon = <Zap aria-hidden className="size-3.5 text-saved" />;
      meta = `${AGENT_NAME[item.agent]} got a local answer: ${RULE_NAME[item.ruleId ?? "json-format"]}, ${formatInt(item.tokens)} tokens avoided`;
      amount = <span className="num text-saved">+{formatUsd(item.usd)} saved</span>;
      tint = "var(--saved-fill)";
      break;
    case "loop":
      icon = <OctagonAlert aria-hidden className="size-3.5 text-alert" />;
      meta = `${AGENT_NAME[item.agent]} sent the same request ${item.repeats ?? 0} times; circuit breaker engaged`;
      amount = <span className="num font-medium text-alert">{formatUsd(item.usd)} wasted</span>;
      tint = "var(--alert)";
      break;
    case "blocked":
      icon = <Ban aria-hidden className="size-3.5 text-saved" />;
      meta = `${AGENT_NAME[item.agent]}: repeat blocked before it reached the model`;
      amount = <span className="num text-saved">{formatUsd(item.usd)} saved</span>;
      tint = "var(--saved-fill)";
      break;
  }

  return (
    <li
      className={`flex gap-3 border-b border-rule px-1 py-2.5 last:border-b-0 ${animate ? "arrive" : ""}`}
      style={{ "--tint": tint } as CSSProperties}
    >
      <span aria-hidden className="mt-0.5 block w-[3px] shrink-0 self-stretch rounded-full" style={{ background: AGENT_COLOR[item.agent] }} />
      <div className="min-w-0 flex-1">
        <p className="flex items-start gap-1.5 text-sm font-medium leading-snug">
          {icon}
          <span className="min-w-0">{item.title}</span>
        </p>
        <p className="mt-0.5 text-[13px] leading-snug text-ink-2">{meta}</p>
      </div>
      <p className="shrink-0 pt-0.5 text-right text-sm">{amount}</p>
    </li>
  );
}

export function LiveFeed({ feed, live }: { feed: readonly FeedItem[]; live: boolean }) {
  return (
    <section aria-label="Live activity" className="flex min-h-0 min-w-0 flex-col">
      <h2 className="text-lg font-semibold tracking-tight">Live activity</h2>
      <p className="mt-0.5 text-sm text-ink-2">Every task an agent sends passes through the router first.</p>
      {feed.length === 0 ? (
        <p className="mt-6 text-sm text-ink-2">Nothing yet. Start a sprint to watch tasks arrive.</p>
      ) : (
        <ul className="mt-3 max-h-[420px] min-h-0 flex-1 overflow-y-auto pr-1">
          {feed.map((item) => (
            <Row key={item.id} item={item} animate={live} />
          ))}
        </ul>
      )}
    </section>
  );
}
