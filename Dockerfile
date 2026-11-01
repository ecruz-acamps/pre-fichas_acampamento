# ---------- 1) Gera o site (React/Vite) ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY admin ./admin
COPY public ./public
COPY src ./src
COPY shared ./shared
RUN npm run build

# ---------- 2) Imagem final: só o servidor e o site gerado ----------
FROM node:22-alpine
ENV NODE_ENV=production \
    TZ=America/Sao_Paulo
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY shared ./shared
COPY marcas ./marcas
COPY --from=build /app/dist ./dist
# Versão (commit do Git) desta imagem, para o aviso de atualização no painel
ARG VERSAO_COMMIT=""
ARG VERSAO_DATA=""
ARG VERSAO_BRANCH=""
RUN printf '{"commit":"%s","data":"%s","branch":"%s"}\n' "$VERSAO_COMMIT" "$VERSAO_DATA" "$VERSAO_BRANCH" > versao.json
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/saude || exit 1
CMD ["node", "server/index.js"]
