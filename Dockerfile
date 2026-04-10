FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    curl wget nodejs npm git \
    && rm -rf /var/lib/apt/lists/*

RUN apt-get update && apt-get install -y \
    prusa-slicer \
    && rm -rf /var/lib/apt/lists/* \
    && prusa-slicer --version || echo "installed"

WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
RUN mkdir -p /app/profiles

EXPOSE 3000
CMD ["node", "server.js"]
