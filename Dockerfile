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
