FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

EXPOSE 4000

ENV NODE_ENV=production
ENV PORT=4000

CMD ["node", "src/server.js"]
