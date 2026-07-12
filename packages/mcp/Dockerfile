# Minimal container for MCP directory health checks (Glama et al.) — starts the
# published stdio server and responds to introspection. No secrets baked in;
# buying works without config (wallet key is an optional runtime env var).
FROM node:20-slim
RUN npm install -g @payanagent/mcp
ENTRYPOINT ["payanagent-mcp"]
