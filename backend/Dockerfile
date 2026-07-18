# AgentScore backend — API + arbiter worker.
FROM node:22-slim
WORKDIR /app

COPY package.json ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src

ENV PORT=8787
EXPOSE 8787

# Runs the API and the always-on arbiter worker. Set API_ONLY=1 to run read-only.
# Signing keys are provided as runtime env/secrets, never baked into the image.
CMD ["npm", "start"]
