FROM node:22-slim
RUN apt-get update && apt-get install -y build-essential python3 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm install
COPY src/ ./src/
RUN npm run build
EXPOSE 3000
ENV NODE_ENV=production
ENV AUTH_SERVER_PORT=3000
ENV AGID_WORKSPACE_PATH=/data/workspace
ENV AGID_SESSIONS_PATH=/data/sessions
VOLUME ["/data"]
CMD ["node", "dist/start.js"]
