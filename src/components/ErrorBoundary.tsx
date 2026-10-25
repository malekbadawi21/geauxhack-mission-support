// ErrorBoundary.tsx — catches a rendering error in one section so the rest of the page keeps working.
//
// How it fits: App.tsx wraps each major section (status strip, cards, charts, flags, daily report,
// trace, pipeline panel) in one of these. Without it, an exception thrown while React renders any
// component unmounts the WHOLE tree and the page goes blank (Phase 6 bug K1). With it, only the
// broken section is replaced by "This section failed to render" plus the error message, so a judge
// still sees everything else and we can read what went wrong.

import { Component, type ErrorInfo, type ReactNode } from "react";
import { TriangleAlert } from "lucide-react";

type Props = {
  name: string; // shown in the message, e.g. "Consumables"
  resetKey: string; // when this changes (e.g. the as-of day), the section tries to render again
  children: ReactNode;
};

type State = { error: Error | null; resetKey: string }; // resetKey: the key the error happened under

/**
 * React only supports error boundaries as class components: there is no hook for
 * getDerivedStateFromError yet. That is the one reason this file uses a class.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: this.props.resetKey };

  /** React calls this after a child throws during render; the returned fields are merged into the state. */
  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  /**
   * React calls this before every render. A new resetKey (another day picked) clears the error, so
   * moving on gives the section another try. Returning null means "no state change".
   */
  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.resetKey ? { error: null, resetKey: props.resetKey } : null;
  }

  /** Logs the error with the section name, so the console (and npm run qa) shows where it came from. */
  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[${this.props.name}] failed to render:`, error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <section className="section-error panel" role="alert">
        <TriangleAlert size={16} aria-hidden="true" />
        <div>
          <strong>This section failed to render</strong> ({this.props.name})
          <div className="mono small dim">{this.state.error.message}</div>
        </div>
      </section>
    );
  }
}
