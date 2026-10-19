FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --chown=node:node . .
RUN mkdir -p /data/uploads && chown -R node:node /data/uploads
USER node
EXPOSE 3001
CMD ["npm","start"]
