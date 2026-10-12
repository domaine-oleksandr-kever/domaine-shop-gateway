import { RouteHandler } from "gadget-server";
import { corsOptions } from "../lib/config";

const route: RouteHandler = async ({ reply }) => {
  await reply
    .code(405)
    .header("Allow", "POST")
    .send({ error: "method_not_allowed", error_description: "This server is stateless: use POST" });
};

route.options = { cors: corsOptions };

export default route;
