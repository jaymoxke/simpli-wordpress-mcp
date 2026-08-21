import { createServer } from "node:http";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { WordPressClient } from "./wordpress.js";

const config = loadConfig();
const logger = createLogger(config);
const wordpress = new WordPressClient(config, logger);
let dumped = false;

const server = createServer(async (_req, res) => {
  try {
    const snapshot = await wordpress.getToolSnapshot(true);
    const catalog = await wordpress.callTool("simpli_catalog", {});
    if (!dumped) {
      dumped = true;
      console.error(`SIMPLI_ABILITY_CATALOG ${JSON.stringify(catalog.structuredContent ?? catalog.content ?? null)}`);
    }
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify({ ok: true, toolCount: snapshot.tools.length }));
  } catch (error) {
    console.error(`SIMPLI_CATALOG_ERROR ${error instanceof Error ? error.message : String(error)}`);
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "diagnostic_failed" }));
  }
});

server.listen(config.port, "0.0.0.0");
