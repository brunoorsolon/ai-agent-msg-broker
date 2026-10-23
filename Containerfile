# Exact runtime pin. Resolve and record an approved image digest before deployment.
# This tag's pull/build result is a CI gate, not a claimed local container test.
FROM node:24.19.0-bookworm-slim AS base
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY reference ./reference
COPY scripts ./scripts
RUN node --input-type=module -e "import {DatabaseSync} from 'node:sqlite'; if(process.versions.node!=='24.19.0')process.exit(1); const d=new DatabaseSync(':memory:'); if(d.prepare('SELECT sqlite_version() AS v').get().v!=='3.53.3')process.exit(1); d.close()" \
    && mkdir -p /data && chown node:node /data && chmod 700 /data

FROM node:24.19.0-bookworm AS test
WORKDIR /app
COPY --from=base /app /app
COPY test ./test
COPY fixtures ./fixtures
COPY openapi.json ./
RUN openssl version && npm run check && npm test

FROM base AS runtime
USER node
ENV NODE_ENV=production
ENV BROKER_CONFIG_FILE=/run/broker/config.json
VOLUME ["/data"]
EXPOSE 8787
STOPSIGNAL SIGTERM
CMD ["node", "src/main.mjs"]
