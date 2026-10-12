import { useEffect, useState } from "react";
import { loadConfig } from "../lib/auth";

export function ConnectClaudeCode() {
  const [command, setCommand] = useState<string | null>(null);
  const [copied, setCopied] = useState<string>("");

  useEffect(() => {
    loadConfig().then(
      (config) => setCommand(config.mcpCommand),
      () => setCommand(null)
    );
  }, []);

  const copy = async () => {
    if (!command) return;
    try {
      await navigator.clipboard.writeText(command);
      setCopied("Copied.");
    } catch {
      setCopied("Copy failed: select the command and copy it by hand.");
    }
  };

  if (!command) return null;
  return (
    <div className="stack">
      <pre className="command">
        <code>{command}</code>
      </pre>
      <div className="row">
        <button type="button" className="button secondary" onClick={copy}>
          Copy command
        </button>
        <span role="status" className="muted small">
          {copied}
        </span>
      </div>
      <p>Then run /mcp in Claude Code and sign in.</p>
    </div>
  );
}
