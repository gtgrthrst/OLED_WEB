# ── Stage 1: Build ────────────────────────────────────────────────────────
FROM golang:1.24-alpine AS builder

WORKDIR /build

# Copy dependency files first (better layer caching)
COPY go.mod ./
RUN go mod download

# Copy source and build a statically-linked binary
COPY main.go ./
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -ldflags="-w -s" -trimpath -o oled_web .

# ── Stage 2: Runtime ──────────────────────────────────────────────────────
# Use minimal image (~5 MB); ca-certificates needed for HTTPS to GitHub
FROM alpine:3.21

RUN apk --no-cache add ca-certificates tzdata && \
    addgroup -S oled && adduser -S oled -G oled

WORKDIR /app

# Copy binary and static assets
COPY --from=builder /build/oled_web ./
COPY static/ ./static/

# Drop to non-root user
USER oled

EXPOSE 8090

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -qO- http://localhost:8090/ > /dev/null || exit 1

CMD ["./oled_web"]
