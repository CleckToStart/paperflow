import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="fatal-screen">
          <section>
            <h1>界面渲染失败</h1>
            <p>{this.state.error.message || String(this.state.error)}</p>
            <button className="primary-action" onClick={() => window.location.reload()}>
              重新加载
            </button>
          </section>
        </div>
      );
    }

    return this.props.children;
  }
}
