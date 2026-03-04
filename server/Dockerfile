FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production=false

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# Remove dev dependencies for smaller image
RUN npm prune --production

ARG API_PORT=3001
ENV API_PORT=${API_PORT}

EXPOSE ${API_PORT}

CMD ["node", "dist/index.js"]
