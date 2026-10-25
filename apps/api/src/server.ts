import { serve } from "@hono/node-server";
import { installScopedFetch, startWatchdog } from "./scanctx.js";

installScopedFetch();
const { createApp } = await import("./index.js");

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: createApp().fetch, port }, (i) => console.log(`swapchan api on :${i.port}`));
startWatchdog();
