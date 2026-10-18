import { gwRoute } from "../../lib/gw";
import { listStores } from "../../lib/stores";

export default gwRoute(async ({ api }, user) => listStores(api, user));
