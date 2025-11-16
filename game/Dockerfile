# ----------------------------
# 1) Stage de build
# ----------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# Copia somente os arquivos essenciais primeiro (para cache de dependências)
COPY package*.json ./

# Instala dependências (produção + dev, caso exista build)
RUN npm install

# Copia todo o código
COPY . .

# Se houver algum tipo de build (como minificação, assets, etc), rode:
# RUN npm run build


# ----------------------------
# 2) Stage final (runtime)
# ----------------------------
FROM node:20-alpine AS runtime

WORKDIR /app

# Copia dependências instaladas
COPY --from=builder /app/node_modules ./node_modules

# Copia o restante do app (inclui server.js, public/, etc)
COPY --from=builder /app ./

# Usa usuário não-root (melhor prática em Kubernetes)
RUN addgroup --system appgroup && adduser --system appuser --ingroup appgroup
USER appuser

# Expõe porta do seu servidor Node
EXPOSE 3000

# Start
CMD ["node", "server.js"]