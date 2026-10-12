import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { RouteHandler } from "gadget-server";
import { bearerToken, sendUnauthorized, verifyBearer } from "../lib/auth";
import { corsOptions } from "../lib/config";
import { createMcpServer } from "../lib/mcp";

const route: RouteHandler = async ({ request, reply, logger, api, connections }) => {
  const principal = await verifyBearer(request.headers.authorization, logger);
  if (!principal) return sendUnauthorized(reply);

  const bearer = bearerToken(request.headers.authorization)!;
  const server = createMcpServer({ principal, bearer, api, connections, logger });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  reply.raw.on("close", () => {
    void transport.close();
    void server.close();
  });

  // Hijacked replies skip Fastify's onSend hooks, so the CORS header is set on the raw response.
  reply.hijack();
  reply.raw.setHeader("Access-Control-Allow-Origin", "*");
  await server.connect(transport);
  await transport.handleRequest(request.raw, reply.raw, request.body);
};

route.options = { cors: corsOptions };

export default route;
