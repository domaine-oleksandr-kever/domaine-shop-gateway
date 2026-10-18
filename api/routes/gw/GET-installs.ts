import { gwRoute } from "../../lib/gw";
import { listPendingInstalls } from "../../lib/installs";

export default gwRoute(async ({ api }, user) => listPendingInstalls(api, user));
