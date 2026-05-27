import React from "react";

export default function NavRail({ items, activePage, setActivePage }) {
  return (
    <nav className="nav-rail">
      <div className="nav-logo">P</div>
      <div className="nav-items">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              className={`nav-button ${activePage === item.key ? "active" : ""}`}
              title={item.label}
              onClick={() => setActivePage(item.key)}
            >
              <Icon size={19} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
