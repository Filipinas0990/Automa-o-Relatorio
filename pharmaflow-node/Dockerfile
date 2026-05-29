FROM node:20-slim

WORKDIR /app
COPY package*.json ./
RUN npm install

# Instala o Chromium e TODAS as dependências de sistema automaticamente
RUN npx playwright install chromium
RUN npx playwright install-deps chromium

COPY . .
# TypeScript compilado no host antes do docker build (evita OOM dentro do container)
# Execute: node --max-old-space-size=2048 node_modules/.bin/tsc --skipLibCheck

EXPOSE 8000
CMD ["node", "dist/api/index.js"]
