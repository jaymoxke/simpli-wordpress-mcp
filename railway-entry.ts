import { loadConfig } from "./src/config.js";
import { startServer } from "./src/server.js";

const config = loadConfig();

startServer(config).catch((error) => {
  console.error(
    JSON.stringify({
      level: "error",
      message: "Startup failed",
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
});
