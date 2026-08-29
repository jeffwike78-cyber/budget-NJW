import { Component } from 'react';

// A blank white page is the worst failure mode — it hides the cause and gives
// the user nothing to act on. This catches any render/runtime error in a page
// and shows the actual message (and a Reload) instead, so a single bad row or
// unexpected value degrades to a readable note rather than killing the app.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('Page crashed:', error, info?.componentStack);
  }

  render() {
    if (this.state.error) {
      const { error } = this.state;
      return (
        <section className="card">
          <div className="card-header">
            <h2>Something went wrong on this page</h2>
          </div>
          <p className="module-note form-error">{error.message || String(error)}</p>
          <button type="button" className="primary-btn" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </section>
      );
    }
    return this.props.children;
  }
}
