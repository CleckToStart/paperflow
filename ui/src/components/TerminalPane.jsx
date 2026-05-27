import React from "react";
import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SquareTerminal } from "lucide-react";
import "@xterm/xterm/css/xterm.css";

export default function TerminalPane({ selectedRepo, selectedSessionId, paperflow }) {
  const containerRef = useRef(null);
  const terminalRef = useRef(null);
  const fitAddonRef = useRef(null);
  const terminalSessionIdRef = useRef("");
  const [terminalSessionId, setTerminalSessionId] = useState("");
  const [terminalError, setTerminalError] = useState("");

  useEffect(() => {
    if (!containerRef.current) return undefined;
    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: "Consolas, Monaco, monospace",
      fontSize: 13,
      theme: {
        background: "#0f172a",
        foreground: "#e5e7eb",
        cursor: "#ffffff",
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);
    fitAddon.fit();
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const disposeData = paperflow.onTerminalData(({ terminalSessionId: incomingId, data }) => {
      if (incomingId === terminalSessionIdRef.current) terminal.write(data);
    });
    const disposeExit = paperflow.onTerminalExit(({ terminalSessionId: incomingId }) => {
      if (incomingId === terminalSessionIdRef.current) terminal.writeln("\r\n[终端会话已退出]");
    });
    terminal.onData((data) => {
      if (terminalSessionIdRef.current) paperflow.writeTerminal(terminalSessionIdRef.current, data).catch(console.error);
    });
    const handleResize = () => {
      fitAddon.fit();
      if (terminalSessionIdRef.current) {
        paperflow.resizeTerminal(terminalSessionIdRef.current, terminal.cols, terminal.rows).catch(console.error);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => {
      disposeData();
      disposeExit();
      window.removeEventListener("resize", handleResize);
      terminal.dispose();
    };
  }, [paperflow]);

  async function openTerminal() {
    if (!selectedRepo) return;
    try {
      const record = await paperflow.createTerminalSession({
        repo_root: selectedRepo,
        session_id: selectedSessionId || null,
      });
      terminalSessionIdRef.current = record.terminal_session_id;
      setTerminalSessionId(record.terminal_session_id);
      setTerminalError("");
      terminalRef.current?.clear();
      terminalRef.current?.writeln(`[终端 ${record.terminal_session_id}] ${record.repo_root}`);
      fitAddonRef.current?.fit();
      paperflow
        .resizeTerminal(record.terminal_session_id, terminalRef.current?.cols || 100, terminalRef.current?.rows || 36)
        .catch(console.error);
    } catch (error) {
      setTerminalError(error.message || String(error));
      terminalRef.current?.writeln(`\r\n[终端启动失败] ${error.message || String(error)}`);
    }
  }

  return (
    <section className="terminal-pane">
      <header className="pane-header">
        <div>
          <h2>终端</h2>
          <p>{terminalError || terminalSessionId || "尚未启动会话"}</p>
        </div>
        <button className="icon-text-button dark" onClick={openTerminal}>
          <SquareTerminal size={16} />
          <span>启动</span>
        </button>
      </header>
      <div ref={containerRef} className="terminal-host" />
    </section>
  );
}
