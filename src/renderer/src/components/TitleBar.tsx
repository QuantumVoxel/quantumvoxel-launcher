import "./TitleBar.css";
import { useEffect, useState, ReactNode } from "react";
import { FaTimes, FaWindowMaximize, FaWindowMinimize } from "react-icons/fa";

interface TitleBarProps {
  actions?: ReactNode;
  tabs?: ReactNode;
}

export function TitleBar({ actions }: TitleBarProps) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    window.electronAPI.isMaximized().then(setMaximized);
  }, []);

  async function toggleMaximize() {
    const value = await window.electronAPI.maximize();
    setMaximized(value);
  }

  return (
    <header className="titlebar">
      <div className="brand">
        {actions && <div className="titlebar-actions">{actions}</div>}
      </div>
      <div className="window-controls-back">
        <div className="window-controls">
          <button
            className="window-button"
            onClick={() => window.electronAPI.minimize()}
            aria-label="Minimize"
          >
            <FaWindowMinimize/>
          </button>

          <button
            className="window-button"
            onClick={toggleMaximize}
            aria-label={maximized ? "Restore" : "Maximize"}
          >
            <FaWindowMaximize/>
          </button>

          <button
            className="window-button close"
            onClick={() => window.electronAPI.close()}
            aria-label="Close"
          >
            <FaTimes/>
          </button>
        </div>
      </div>
    </header>
  );
}
