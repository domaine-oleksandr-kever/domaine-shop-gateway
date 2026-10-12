import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Principal } from "./auth";

const INSTRUCTIONS =
  "Domaine Shop Gateway: authenticated access to Domaine's Shopify tooling. Call `ping` to check the connection and see which identity the gateway resolved for you.";

export function createMcpServer(principal: Principal): McpServer {
  const server = new McpServer({ name: "domaine-shop-gateway", version: "0.1.0" }, { instructions: INSTRUCTIONS });
  server.registerTool("ping", { description: "Check the gateway connection and return the caller's identity." }, async () => ({
    content: [
      {
        type: "text",
        text: JSON.stringify({ ok: true, sub: principal.sub, email: principal.email ?? null, time: new Date().toISOString() }),
      },
    ],
  }));
  return server;
}
