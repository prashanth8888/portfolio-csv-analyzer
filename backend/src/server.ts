import { createServer } from "node:http";

import { createApp } from "./app.ts";

const port = Number(process.env.PORT ?? 4177);
const app = createApp();
const server = createServer(app);

server.listen(port, () => {
  console.log(`Portfolio backend listening on http://localhost:${port}`);
});
