FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    curl wget nodejs npm fuse libfuse2 \
    libgtk-3-0 libglu1-mesa libgl1-mesa-glx \
    libglib2.0-0 libdbus-1-3 libxrender1 \
    libxi6 libxext6 libx11-6 libxrandr2 \
    libxss1 libnss3 libgconf-2-4 \
    xvfb \
    && rm -rf /var/lib/apt/lists/*

RUN wget -q \
    "https://github.com/SoftFever/OrcaSlicer/releases/download/v2.1.1/OrcaSlicer_Linux_V2.1.1.AppImage" \
    -O /opt/orca.AppImage \
    && chmod +x /opt/orca.AppImage

RUN cd /opt && ./orca.AppImage --appimage-extract \
    && ln -sf /opt/squashfs-root/AppRun /usr/local/bin/orcaslicer \
    && rm /opt/orca.AppImage

RUN orcaslicer --help 2>&1 | head -5 || echo "OrcaSlicer extracted"

WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
RUN mkdir -p /app/profiles

EXPOSE 3000
CMD ["node", "server.js"]
