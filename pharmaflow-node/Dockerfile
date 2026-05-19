FROM node:20-slim

WORKDIR /app
COPY package*.json ./
RUN npm install

# Instala o Chromium e TODAS as dependências de sistema automaticamente
RUN npx playwright install chromium
RUN npx playwright install-deps chromium

COPY . .
RUN npm run build

EXPOSE 8000
CMD ["node", "dist/api/index.js"]
