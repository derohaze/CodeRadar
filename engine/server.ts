/**
 * The backend's run file.
 *
 *     cd engine
 *     bun run server.ts      # or: bun run serve
 *
 * It binds the local review API on 127.0.0.1:9000, prints the URL and the token
 * every data route requires, and stays up until Ctrl+C.
 *
 * The implementation is `src/node/serve.ts` — one entry point per behaviour, not
 * a second copy of it. This file exists so the engine has an obvious run file at
 * its root instead of only a script name inside `package.json`.
 */

import { main } from "./src/node/serve.ts";

await main();
