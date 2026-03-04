FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production=false

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# Remove dev dependencies for smaller image
RUN npm prune --production

EXPOSE 3001

CMD ["node", "dist/index.js"]
