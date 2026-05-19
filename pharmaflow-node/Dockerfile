FROM node:20-slim

# Dependências do Chromium para Playwright
RUN apt-get update && apt-get install -y \
    libnss3 libnspr4 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libxkbcommon0 libatspi2.0-0 libxcomposite1 \
    libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install
RUN npx playwright install chromium

COPY . .
RUN npm run build

EXPOSE 8000
CMD ["node", "dist/api/index.js"]
