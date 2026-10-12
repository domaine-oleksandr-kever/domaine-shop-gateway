import { gwRoute } from "../../lib/gw";

export default gwRoute(async (_context, user) => ({
  sub: user.sub,
  email: user.email,
  name: user.name,
  globalRole: user.globalRole,
}));
