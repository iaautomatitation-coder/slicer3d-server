FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# Dependencias del sistema
RUN apt-get update && apt-get install -y \
    curl wget nodejs npm \
    libgtk-3-0 libglu1-mesa libgl1-mesa-glx \
    libglib2.0-0 libdbus-1-3 libxrender1 \
    libxi6 libxext6 libx11-6 libxrandr2 \
    libxss1 libgconf-2-4 libnss3 \
    && rm -rf /var/lib/apt/lists/*

# Descargar e instalar OrcaSlicer CLI
RUN wget -q \
    https://github.com/SoftFever/OrcaSlicer/releases/download/v2.1.1/OrcaSlicer_Linux_V2.1.1.AppImage \
    -O /tmp/orca.AppImage \
    && chmod +x /tmp/orca.AppImage \
    && cd /tmp && ./orca.AppImage --appimage-extract \
    && mv /tmp/squashfs-root /opt/orcaslicer \
    && ln -s /opt/orcaslicer/AppRun /usr/local/bin/orcaslicer \
    && rm /tmp/orca.AppImage

WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
RUN mkdir -p /app/profiles

EXPOSE 3000
CMD ["node", "server.js"]
