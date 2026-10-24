# Zuri Cloud API image.
#
# Railway deploys this repository from its root, so the build context is the repo
# root and the server lives in server/. Keeping the Dockerfile here means a plain
# git push produces the API instead of trying to start the Electron desktop app.
FROM node:20-alpine

WORKDIR /app

# Install dependencies first so a source-only change reuses this layer.
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

COPY server/ ./

ENV NODE_ENV=production
EXPOSE 8080

# The schema is applied on boot (see src/schema.js), so no separate migrate step.
CMD ["npm", "start"]
