// If anything inside the editor throws while drawing, show a short message
// instead of a blank page. React only offers this as a class component,
// which is why this is the one class in the project.

import { Component, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { message: string | null };

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { message: null };

  static getDerivedStateFromError(error: unknown): State {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  override render(): ReactNode {
    if (this.state.message === null) return this.props.children;
    return (
      <div className="mi">
        <div className="mi__inner">
          <section className="panel panel--empty" role="alert">
            <p>
              Something went wrong while showing this capture. Reload the page to try again.
              <br />
              <code>{this.state.message}</code>
            </p>
          </section>
        </div>
      </div>
    );
  }
}
