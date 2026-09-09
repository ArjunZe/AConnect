FROM node:18-alpine

WORKDIR /app

# Copy package.json explicitly 
COPY package.json ./

# Clean npm cache and force install express manually alongside others
RUN npm cache clean --force
RUN npm install express cors dotenv express-rate-limit helmet simple-peer socket.io

# Copy the rest of your server code (server.js, etc.)
COPY . .

EXPOSE 8080

CMD ["node", "server.js"]
