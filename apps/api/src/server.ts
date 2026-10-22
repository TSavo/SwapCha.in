import { serve } from "@hono/node-server";
import { createApp } from "./index.js";

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: createApp().fetch, port }, (i) => console.log(`swapchan api on :${i.port}`));
