import { formatInt } from "@ai-finops/interceptor";
import type { RunawayLoopAlert } from "@ai-finops/interceptor";
import { OctagonAlert, ShieldCheck } from "lucide-react";
import type { EngineState } from "../lib/engine";
import { AGENT_NAME, headlineUsd } from "../lib/labels";
import type { SprintRow } from "../lib/view-model";

function sprintLabel(alert: RunawayLoopAlert, sprints: readonly SprintRow[]): string {
  return sprints.find((s) => s.sessionId === alert.sessionId)?.label ?? alert.sessionId;
}

export function LoopPanel({ engine, sprints }: { engine: EngineState; sprints: readonly SprintRow[] }) {
  const { loopAlerts, prevented } = engine;
  return (
    <section aria-label="Runaway loops" className="min-w-0">
      <h2 className="text-lg font-semibold tracking-tight">Runaway loops</h2>
      <p className="mt-0.5 text-sm text-ink-2">
        An agent that sends the identical request four times in a row is stuck. The breaker then blocks further repeats.
      </p>
      {loopAlerts.length === 0 ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-ink-2">
          <ShieldCheck aria-hidden className="size-4 text-saved" />
          No loops detected. Every agent is making progress.
        </p>
      ) : (
        <>
          <ul className="mt-3">
            {loopAlerts.map((alert) => (
              <li key={`${alert.sessionId}-${alert.fingerprint}`} className="flex gap-3 border-b border-rule py-2.5 last:border-b-0">
                <OctagonAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-alert" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {AGENT_NAME[alert.agent]} sent one request {alert.repeats} times
                  </p>
                  <p className="text-[13px] text-ink-2">
                    {sprintLabel(alert, sprints)}, {formatInt(alert.wastedTokens)} tokens burned before it was caught
                  </p>
                </div>
                <p className="num shrink-0 text-sm font-medium text-alert">{headlineUsd(alert.wastedCostUsd)}</p>
              </li>
            ))}
          </ul>
          <p className="mt-2 flex items-center gap-2 text-sm">
            <ShieldCheck aria-hidden className="size-4 shrink-0 text-saved" />
            <span>
              The breaker blocked {formatInt(prevented.calls)} further {prevented.calls === 1 ? "repeat" : "repeats"}, keeping{" "}
              <span className="num font-medium text-saved">{headlineUsd(prevented.usd)}</span> off the bill.
            </span>
          </p>
        </>
      )}
    </section>
  );
}
