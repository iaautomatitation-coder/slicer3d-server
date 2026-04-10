FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    curl wget nodejs npm git \
    libglib2.0-0 libgl1 libglu1-mesa \
    && rm -rf /var/lib/apt/lists/*

# Descargar PrusaSlicer AppImage y extraerlo (sin FUSE)
RUN wget -q https://github.com/prusa3d/PrusaSlicer/releases/download/version_2.7.4/PrusaSlicer-2.7.4+linux-x64-GTK3-202312111303.AppImage \
    -O /tmp/prusa-slicer.AppImage \
    && chmod +x /tmp/prusa-slicer.AppImage \
    && cd /tmp && /tmp/prusa-slicer.AppImage --appimage-extract \
    && mv /tmp/squashfs-root /opt/prusa-slicer \
    && ln -s /opt/prusa-slicer/usr/bin/prusa-slicer /usr/local/bin/prusa-slicer \
    && rm /tmp/prusa-slicer.AppImage \
    && prusa-slicer --version

WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
RUN mkdir -p /app/profiles

EXPOSE 3000
CMD ["node", "server.js"]
