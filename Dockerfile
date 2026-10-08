# Ringside: one container, one SQLite file on a persistent volume.
#   docker build -t ringside .
#   docker run -p 3000:3000 -v ringside-data:/data -e SITE_URL=https://example.com ringside
# See docs/deploy.md. An optional in-container nightly update and backup: docs/nightly.md.

FROM node:22-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# route types are generated, not checked in
RUN npx next typegen && npm run build
# the runtime needs only production dependencies (tsx stays for the maintenance scripts: model:fit, wikidata:import, ...)
RUN npm prune --omit=dev && npm install --no-save --no-audit --no-fund "tsx@^4"

FROM node:22-slim AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 DATABASE_PATH=/data/ringside.db
RUN mkdir -p /data && chown node:node /data
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/next.config.ts ./
# read at run time by path (fonts for share images, the fitted model, the translation glossary, research inbox) and by the maintenance scripts
COPY --from=build --chown=node:node /app/assets ./assets
COPY --from=build --chown=node:node /app/data ./data
COPY --from=build --chown=node:node /app/i18n ./i18n
COPY --from=build --chown=node:node /app/lib ./lib
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/tsconfig.json ./
# the fitted model (npm run model:fit) is read and written at data/model-fit.json: point it into the volume so a redeploy keeps it
RUN rm -f data/model-fit.json && ln -s /data/model-fit.json data/model-fit.json
USER node
VOLUME /data
EXPOSE 3000
# the world is built before the server accepts traffic (instrumentation.ts), so give a large database time to start
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# the site; with NIGHTLY_SCHEDULE=HH:MM (UTC) set, the entrypoint also starts the optional nightly job's scheduler beside it (docs/nightly.md). Unset, it is exactly `npm start`.
CMD ["sh", "scripts/docker-entrypoint.sh"]
