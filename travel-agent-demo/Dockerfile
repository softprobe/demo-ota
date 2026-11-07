FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public
COPY references ./references

EXPOSE 4310
CMD ["node", "src/start.mjs"]
