# Contexto de build: carpeta `frontend/` (Railway: Root Directory = `frontend`).
# Vite incrusta VITE_* solo en `npm run build` → la variable debe existir en ese paso (ARG/ENV).
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
# postinstall ejecuta scripts/rm-dup-at-types.mjs; debe existir antes de npm ci.
COPY scripts ./scripts/
RUN npm ci

COPY . .

ARG VITE_API_BASE
ENV VITE_API_BASE=${VITE_API_BASE}

RUN npm run build

FROM node:22-alpine
WORKDIR /app
RUN npm install -g serve@14

COPY --from=build /app/dist ./dist

ENV NODE_ENV=production
EXPOSE 8080

# Railway inyecta PORT; escuchar en todas las interfaces.
CMD ["sh", "-c", "serve -s dist -l tcp://0.0.0.0:${PORT:-8080}"]
