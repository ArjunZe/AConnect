FROM node:18-alpine

WORKDIR /app

# Copy package.json explicitly 
COPY package.json ./

# Clean npm cache and force install express manually alongside others
RUN npm cache clean --force
RUN npm install express cors dotenv express-rate-limit helmet simple-peer socket.io

# Copy the rest of your server code (server.js, etc.)
COPY . .

# Ensure storage directories exist
RUN mkdir -p /app/data /app/public/uploads

# Set default environment variables
ENV PORT=9876
ENV DATA_DIR=/app/data
EXPOSE 9876

CMD ["node", "server.js"]
