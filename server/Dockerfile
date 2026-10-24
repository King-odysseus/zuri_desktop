# Railway builds the cloud service from this folder.
# The React dashboard is pre-built into public/ by `npm run web:build` at the
# repo root, so the image only needs the server's own runtime dependencies.
FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

# Copy the manifests first so `npm ci` is cached until dependencies change.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# Railway injects PORT; the server defaults to 8080 when it is absent.
EXPOSE 8080
CMD ["node", "src/server.js"]
