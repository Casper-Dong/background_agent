import { ReactNode } from "react";
import { Link } from "react-router-dom";

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="app">
      <header className="header">
        <Link to="/" className="header-logo">
          <span className="header-logo-title">RUE</span>
          <span className="header-logo-subtitle">Repo utility engineer</span>
        </Link>
        <nav className="header-nav">
          <Link to="/">Dashboard</Link>
        </nav>
      </header>
      <main className="main">{children}</main>
    </div>
  );
}
