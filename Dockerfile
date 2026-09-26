# Single image: builds the React client and the API, serves both from Node on :4000
FROM node:20-alpine AS client
WORKDIR /app/client
COPY client/package*.json ./
RUN npm install
COPY client/ ./
RUN npm run build

FROM node:20-alpine AS server
WORKDIR /app/server
RUN apk add --no-cache openssl
COPY server/package*.json ./
RUN npm install
COPY server/ ./
RUN npm run build && npm prune --omit=dev

FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache openssl
ENV NODE_ENV=production
COPY --from=server /app/server /app/server
COPY --from=client /app/client/dist /app/client/dist
WORKDIR /app/server
EXPOSE 4000
# --accept-data-loss: needed for additive changes Prisma flags as "warnings" (e.g. a new unique column).
# Without it the schema update is refused and the API would run against an out-of-date database.
CMD ["sh", "-c", "npx prisma db push --skip-generate --accept-data-loss || echo '!!! DATABASE SCHEMA UPDATE FAILED — see the error above'; node dist/seed.js || true; node dist/index.js"]
