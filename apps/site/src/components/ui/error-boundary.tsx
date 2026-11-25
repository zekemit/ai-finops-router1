"use client";

import { RotateCcw, TriangleAlert } from "lucide-react";
import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface Props {
  /** What failed, in words a visitor understands: "The calculator". */
  readonly label: string;
  readonly children: ReactNode;
}

interface State {
  readonly error: Error | null;
}

/** Contains a failure to one widget so the rest of the page keeps working. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[${this.props.label}]`, error, info.componentStack);
  }

  private readonly reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    return (
      <div role="alert" className="panel flex flex-col items-start gap-3 rounded-2xl p-6">
        <p className="flex items-center gap-2 font-medium">
          <TriangleAlert aria-hidden className="size-4 text-critical" />
          {this.props.label} could not load.
        </p>
        <p className="text-sm text-ink-2">The rest of the page still works. Reload the widget to try again.</p>
        <button type="button" onClick={this.reset} className="glass inline-flex min-h-10 items-center gap-2 rounded-full px-4 text-sm hover:bg-white/10">
          <RotateCcw aria-hidden className="size-4" />
          Try again
        </button>
      </div>
    );
  }
}
