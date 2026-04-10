FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    curl wget nodejs npm \
    libboost-all-dev \
    libcurl4-openssl-dev \
    && rm -rf /var/lib/apt/lists/*

# PrusaSlicer CLI — binario headless sin dependencias gráficas
RUN wget -q \
    "https://github.com/prusa3d/PrusaSlicer/releases/download/version_2.7.4/PrusaSlicer-2.7.4+linux-x64-GTK3-202404050940.AppImage" \
    -O /opt/prusa.AppImage \
    && chmod +x /opt/prusa.AppImage \
    && cd /opt && ./prusa.AppImage --appimage-extract \
    && ln -sf /opt/squashfs-root/AppRun /usr/local/bin/prusa-slicer \
    && rm /opt/prusa.AppImage

WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
RUN mkdir -p /app/profiles

EXPOSE 3000
CMD ["node", "server.js"]
