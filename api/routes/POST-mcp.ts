import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { RouteHandler } from "gadget-server";
import { verifyBearer } from "../lib/auth";
import { corsOptions, metadataUrl } from "../lib/config";
import { createMcpServer } from "../lib/mcp";

const route: RouteHandler = async ({ request, reply, logger }) => {
  const principal = await verifyBearer(request.headers.authorization, logger);
  if (!principal) {
    return reply
      .code(401)
      .header(
        "WWW-Authenticate",
        `Bearer error="unauthorized", error_description="Authorization needed", resource_metadata="${metadataUrl}"`
      )
      .send({ error: "unauthorized", error_description: "Authorization needed" });
  }

  const server = createMcpServer(principal);
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
