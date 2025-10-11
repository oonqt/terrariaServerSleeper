# Dockerfile.sleeper
# Stage: start from the TShock image you just built
FROM local/tshock-base

# Install Node (we need Node 20+). Using Debian-based stretch in many TShock images; adjust if different.
USER root
RUN apt-get update && apt-get install -y curl ca-certificates \
  && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
  && apt-get install -y nodejs \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

# Create app dir and copy sleeping starter
WORKDIR /srv/terraria-sleeper
COPY package.json package-lock.json ./
RUN npm ci --only=production

# Copy the controller script & config into the image
COPY terraria-sleeping-server.js ./terraria-sleeping-server.js
COPY logger.js ./logger.js
# COPY config/ ./config/

# Ensure the TShock server files are in a known path inside the image.
# Many TShock builds place server files under /tshock or /terraria; adjust if needed.
# Expose management API and ready-to-be-mapped ports (these are optional in-image)
EXPOSE 7777 7878

# Run the Node controller as PID 1
ENTRYPOINT [ "node", "./terraria-sleeping-server.js" ]