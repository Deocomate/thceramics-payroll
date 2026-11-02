# dist/index.html is rebuilt from src/ so the image always matches the source
FROM node:22-slim AS build
WORKDIR /app
COPY build.js ./
COPY src ./src
RUN node build.js

FROM node:22-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 TRUST_PROXY=1 DB_FILE=/data/payroll.db
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY --from=build /app/dist ./dist
# owned by node before the volume mounts, so a new volume starts out writable
RUN mkdir /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 3000
CMD ["node", "server/index.js"]
