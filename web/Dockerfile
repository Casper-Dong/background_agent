FROM node:20-alpine AS build

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
ENV API_PORT=3001
COPY nginx-spa.conf /etc/nginx/templates/default.conf.template
EXPOSE 80
