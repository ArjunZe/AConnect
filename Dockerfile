FROM node:18-alpine

WORKDIR /app

# Copy only the package.json since you don't have a lockfile
COPY package.json ./

# Force npm to install dependencies directly from the package.json
RUN npm install

# Copy the rest of your application code (server.js, etc.)
COPY . .

EXPOSE 8080

CMD ["npm", "start"]
