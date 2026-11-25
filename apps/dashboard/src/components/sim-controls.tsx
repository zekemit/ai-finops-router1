import { Pause, Play, Shuffle } from "lucide-react";
import type { Dispatch } from "react";
import { SPEEDS } from "../lib/playback";
import type { PlaybackAction, PlaybackState } from "../lib/playback";

export interface SprintProgress {
  readonly fraction: number;
  readonly label: string;
}

interface Props {
  readonly state: PlaybackState;
  readonly dispatch: Dispatch<PlaybackAction>;
  readonly progress: SprintProgress | null;
  readonly onNewSeed: () => void;
}

const BUTTON = "inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors";

function primaryAction(state: PlaybackState): { label: string; action: PlaybackAction; icon: "play" | "pause" } {
  switch (state.status) {
    case "running":
      return { label: "Pause sprint", action: { type: "pause" }, icon: "pause" };
    case "paused":
      return { label: "Resume sprint", action: { type: "resume" }, icon: "play" };
    case "done":
      return { label: "Simulate another sprint", action: { type: "start" }, icon: "play" };
    case "idle":
      return { label: "Simulate Multi-Agent Sprint", action: { type: "start" }, icon: "play" };
  }
}

export function SimControls({ state, dispatch, progress, onNewSeed }: Props) {
  const primary = primaryAction(state);
  const Icon = primary.icon === "pause" ? Pause : Play;

  return (
    <div className="flex flex-col items-stretch gap-3 sm:items-end">
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <button type="button" onClick={() => dispatch(primary.action)} className={`${BUTTON} bg-ink text-page hover:opacity-90`}>
          <Icon aria-hidden className="size-4" />
          {primary.label}
        </button>

        <div role="radiogroup" aria-label="Simulation speed, in simulated seconds per real second" className="inline-flex rounded-lg border border-rule bg-surface p-0.5">
          {SPEEDS.map((speed) => {
            const selected = state.speed === speed;
            return (
              <button
                key={speed}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => dispatch({ type: "setSpeed", speed })}
                className={`num rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${selected ? "bg-ink text-page" : "text-ink-2 hover:text-ink"}`}
              >
                {speed}×
              </button>
            );
          })}
        </div>

        <button type="button" onClick={onNewSeed} className={`${BUTTON} border border-rule bg-surface text-ink hover:border-axis`}>
          <Shuffle aria-hidden className="size-4" />
          New seed
        </button>
        {state.status !== "idle" && (
          <button type="button" onClick={() => dispatch({ type: "reset" })} className={`${BUTTON} text-ink-2 hover:text-ink`}>
            Reset
          </button>
        )}
      </div>

      <div className="num flex items-center gap-3 text-xs text-ink-2 sm:justify-end">
        <span>Seed {state.seed}</span>
        {progress !== null && (
          <>
            <span
              role="progressbar"
              aria-label="Sprint progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress.fraction * 100)}
              className="block h-1.5 w-40 overflow-hidden rounded-full bg-rule"
            >
              <span className="block h-full rounded-full bg-ink" style={{ width: `${Math.round(progress.fraction * 100)}%` }} />
            </span>
            <span>{progress.label}</span>
          </>
        )}
      </div>
    </div>
  );
}
