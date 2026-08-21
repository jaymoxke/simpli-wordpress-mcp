import { loadConfig } from "./src/config.js";
import { createLogger } from "./src/logger.js";
import { startServer } from "./src/server.js";
import { WordPressClient } from "./src/wordpress.js";

const config = loadConfig();
const logger = createLogger(config);

startServer(config)
  .then(async () => {
    const readiness = await new WordPressClient(config, logger).readiness();
    if (readiness.ready) {
      logger.info("Simpli MCP backend readiness verified", readiness);
      return;
    }
    logger.warn("Simpli MCP backend readiness failed", readiness);
  })
  .catch((error) => {
    console.error(
      JSON.stringify({
        level: "error",
        message: "Startup failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    process.exit(1);
  });
