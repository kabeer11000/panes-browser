# The shared spaces relay (relay.ts). No packages to install: SQLite and WebSockets are Bun's own, and the only
# import outside this folder is the message format (src/shared/share/wire.ts). Built from the repository root.
FROM oven/bun:1-alpine
WORKDIR /app
COPY src/shared/share/wire.ts src/shared/share/wire.ts
COPY share/server/relay.ts share/server/relay.ts
COPY share/web/public share/web/public
ENV PORT=10000 DATA_DIR=/data WEB_DIR=/app/share/web/public
EXPOSE 10000
CMD ["bun", "share/server/relay.ts"]
