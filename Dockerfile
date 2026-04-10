FROM ubuntu:22.04

# Avoid interactive prompts
ENV DEBIAN_FRONTEND=noninteractive

# Install dependencies
RUN apt-get update && apt-get install -y \
    curl \
    wget \
    libgtk-3-0 \
    libglu1-mesa \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libwebkit2gtk-4.0-37 \
    fuse \
    libfuse2 \
    nodejs \
    npm \
    && rm -rf /var/lib/apt/lists/*

# Install OrcaSlicer CLI
# Using AppImage in headless mode
RUN wget -q https://github.com/SoftFever/OrcaSlicer/releases/download/v2.1.1/OrcaSlicer_Linux_V2.1.1.AppImage \
    -O /usr/local/bin/orcaslicer-app && \
    chmod +x /usr/local/bin/orcaslicer-app

# Extract AppImage for headless use (no FUSE needed)
RUN cd /usr/local && \
    /usr/local/bin/orcaslicer-app --appimage-extract && \
    ln -sf /usr/local/squashfs-root/AppRun /usr/local/bin/orcaslicer

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install Node dependencies
RUN npm install --production

# Copy server files
COPY . .

# Create profiles directory
RUN mkdir -p /app/profiles

# Expose port
EXPOSE 3000

# Start server
CMD ["node", "server.js"]
