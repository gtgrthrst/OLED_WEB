#!/bin/sh
# OLED Pixel Designer – Podman helper script

IMAGE="oled_web:latest"
NAME="oled_web"
PORT="${PORT:-8090}"

case "$1" in
  build)
    echo "Building image: $IMAGE"
    podman build -f Containerfile -t "$IMAGE" .
    ;;
  run)
    echo "Starting container: $NAME  →  http://localhost:$PORT"
    podman run -d \
      --name "$NAME" \
      --replace \
      -p "$PORT:8090" \
      --restart unless-stopped \
      --security-opt no-new-privileges \
      "$IMAGE"
    ;;
  up)
    # Build and run in one step
    "$0" build && "$0" run
    ;;
  stop)
    podman stop "$NAME" 2>/dev/null && echo "Stopped."
    ;;
  rm)
    podman stop "$NAME" 2>/dev/null
    podman rm  "$NAME" 2>/dev/null && echo "Removed."
    ;;
  logs)
    podman logs -f "$NAME"
    ;;
  compose-up)
    podman compose -f compose.yaml up -d --build
    ;;
  compose-down)
    podman compose -f compose.yaml down
    ;;
  *)
    cat <<'EOF'
Usage: ./run.sh <command>

  build        Build the container image
  run          Start the container (must build first)
  up           Build + run in one step
  stop         Stop the running container
  rm           Stop and remove the container
  logs         Follow container logs

  compose-up   Start with podman-compose (build if needed)
  compose-down Stop and remove compose services

Environment:
  PORT=8090    Host port to bind (default: 8090)

Examples:
  ./run.sh up                    # Build and start
  PORT=3000 ./run.sh run         # Use a different port
  ./run.sh logs                  # View logs
EOF
    ;;
esac
