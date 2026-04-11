FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    curl wget nodejs npm fuse libfuse2 libgtk-3-0 libglu1-mesa \
    && rm -rf /var/lib/apt/lists/*

# Descargar PrusaSlicer AppImage
RUN wget -q https://github.com/prusa3d/PrusaSlicer/releases/download/version_2.7.4/PrusaSlicer-2.7.4+linux-x64-GTK3-202404050928.AppImage \
    -O /usr/local/bin/prusaslicer \
    && chmod +x /usr/local/bin/prusaslicer

# Extraer AppImage (necesario para Docker)
RUN cd /usr/local/bin && ./prusaslicer --appimage-extract \
    && ln -s /usr/local/bin/squashfs-root/AppRun /usr/local/bin/prusa-slicer

WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .

EXPOSE 3000
CMD ["node", "server.js"]
