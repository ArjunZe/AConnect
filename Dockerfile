FROM node:18-alpine

WORKDIR /app

# Copy package.json explicitly 
COPY package.json ./

# Install dependencies
RUN npm cache clean --force
RUN npm install

# Copy application source
COPY . .

# Set default environment variables
ENV PORT=9876
ENV DEFAULT_ROOM_PASSWORD=turtle
EXPOSE 9876

CMD ["node", "server.js"]
