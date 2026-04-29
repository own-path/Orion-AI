FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

RUN mkdir -p /app/data/voice

ENV NODE_ENV=production

CMD ["node", "services/agent-service/index.js"]
