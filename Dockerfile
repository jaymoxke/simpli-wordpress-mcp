FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY tests ./tests
RUN npm run check
RUN npm test
RUN npm run build
RUN test -f dist/src/server.js \
    && printf 'import { startServer } from "./src/server.js";\nimport { loadConfig } from "./src/config.js";\nimport { createLogger } from "./src/logger.js";\nimport { WordPressClient } from "./src/wordpress.js";\nconst config = loadConfig();\nconst logger = createLogger(config);\nstartServer(config).then(async () => { const readiness = await new WordPressClient(config, logger).readiness(); if (readiness.ready) logger.info("Simpli MCP backend readiness verified", readiness); else logger.warn("Simpli MCP backend readiness failed", readiness); }).catch((error) => { console.error(JSON.stringify({ level: "error", message: "Startup failed", error: error instanceof Error ? error.message : String(error) })); process.exit(1); });\n' > dist/server.js \
    && node --check dist/server.js

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
ENV CHROMIUM_PATH=/usr/bin/chromium
WORKDIR /app
RUN apk add --no-cache chromium \
    && addgroup -S app \
    && adduser -S app -G app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER app
EXPOSE 3000
CMD ["node", "dist/src/server.js"]
