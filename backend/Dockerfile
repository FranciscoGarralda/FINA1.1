# Railway: build context = repo root (`docker build -f backend/Dockerfile .`)
FROM golang:1.25.9-alpine AS build
WORKDIR /src

RUN apk add --no-cache git ca-certificates

COPY backend/go.mod backend/go.sum ./
RUN go mod download

COPY backend/ .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/fina-api ./cmd/api

FROM alpine:3.21
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app

COPY --from=build /out/fina-api .
COPY --from=build /src/migrations /app/migrations

ENV PORT=8080
ENV MIGRATIONS_PATH=/app/migrations
EXPOSE 8080

USER nobody
CMD ["./fina-api"]
