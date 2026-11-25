// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "../src/components/ui/error-boundary";

const flaky = { explode: true };

function Flaky() {
  if (flaky.explode) throw new Error("boom");
  return <p>widget is fine</p>;
}

beforeEach(() => {
  flaky.explode = true;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ErrorBoundary", () => {
  it("renders its children when nothing throws", () => {
    flaky.explode = false;
    render(
      <ErrorBoundary label="The calculator">
        <Flaky />
      </ErrorBoundary>,
    );
    expect(screen.getByText("widget is fine")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("contains a failure to the widget, announces it as an alert that names the widget, and leaves the rest of the page standing", () => {
    render(
      <>
        <p>the rest of the page</p>
        <ErrorBoundary label="The calculator">
          <Flaky />
        </ErrorBoundary>
      </>,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("The calculator could not load.");
    expect(screen.getByText("the rest of the page")).toBeTruthy();
    expect(screen.queryByText("widget is fine")).toBeNull();
  });

  it("logs the error under the widget's label so it can be found in the console", () => {
    render(
      <ErrorBoundary label="The log stream">
        <Flaky />
      </ErrorBoundary>,
    );
    const logged = vi.mocked(console.error).mock.calls.some((args) => args[0] === "[The log stream]" && args[1] instanceof Error && args[1].message === "boom");
    expect(logged).toBe(true);
  });

  it("recovers when 'Try again' is pressed after the cause is gone", () => {
    render(
      <ErrorBoundary label="The calculator">
        <Flaky />
      </ErrorBoundary>,
    );
    flaky.explode = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("widget is fine")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the fallback again, without looping, if the widget still fails after 'Try again'", () => {
    render(
      <ErrorBoundary label="The calculator">
        <Flaky />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByRole("alert").textContent).toContain("The calculator could not load.");
  });
});
