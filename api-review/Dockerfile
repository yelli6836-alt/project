FROM node:20-alpine

WORKDIR /app

# deps
COPY package*.json ./
RUN npm install --omit=dev

# app
COPY src ./src

ENV NODE_ENV=production
EXPOSE 3309
CMD ["node","src/server.js"]
