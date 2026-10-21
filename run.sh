#!/usr/bin/env bash
set -e

# Directory where whis is installed
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8000}"
USE_SSL=false

for arg in "$@"; do
  case $arg in
    --ssl)
      USE_SSL=true
      shift
      ;;
    --port=*)
      PORT="${arg#*=}"
      shift
      ;;
    --host=*)
      HOST="${arg#*=}"
      shift
      ;;
    -h|--help)
      echo "Uso: ./run.sh [opciones]"
      echo ""
      echo "Opciones:"
      echo "  --ssl         Habilita HTTPS con certificado autofirmado (para permisos de microfono sin flags)"
      echo "  --host=IP     Dirección IP de escucha (por defecto 0.0.0.0)"
      echo "  --port=NUM    Puerto de escucha (por defecto 8000)"
      echo "  -h, --help    Muestra esta ayuda"
      exit 0
      ;;
  esac
done

# Activate virtualenv if present
if [ -d ".venv" ]; then
  source .venv/bin/activate
elif [ -d "venv" ]; then
  source venv/bin/activate
fi

# Set LD_LIBRARY_PATH for pip-installed nvidia CUDA libraries if present
NVIDIA_LIBS=$(python3 -c "
import os, sys, glob
site_pkgs = [p for p in sys.path if 'site-packages' in p]
dirs = []
for sp in site_pkgs:
    dirs.extend(glob.glob(os.path.join(sp, 'nvidia', '*', 'lib')))
print(':'.join(dirs))
" 2>/dev/null || true)

if [ -n "$NVIDIA_LIBS" ]; then
  export LD_LIBRARY_PATH="${NVIDIA_LIBS}:${LD_LIBRARY_PATH}"
fi

# Detect primary LAN IP for user convenience
LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
[ -z "$LAN_IP" ] && LAN_IP="localhost"

echo "=========================================================="
echo " 🎙️ Whis — Grabador Web y Transcriptor Local Faster-Whisper"
echo "=========================================================="

SSL_ARGS=""
if [ "$USE_SSL" = true ]; then
  if [ ! -f "key.pem" ] || [ ! -f "cert.pem" ]; then
    echo "Generando certificado SSL autofirmado..."
    openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes -subj "/CN=whis.local" >/dev/null 2>&1
  fi
  SSL_ARGS="--ssl-keyfile key.pem --ssl-certfile cert.pem"
  echo " Protocolo: HTTPS (Certificado autofirmado)"
  echo " Acceso Local: https://localhost:${PORT}"
  echo " Acceso LAN:   https://${LAN_IP}:${PORT}"
  echo ""
  echo " (Acepta la advertencia de certificado en tu navegador)"
else
  echo " Protocolo: HTTP"
  echo " Acceso Local: http://localhost:${PORT}"
  echo " Acceso LAN:   http://${LAN_IP}:${PORT}"
  echo ""
  echo " ℹ️  Nota para micrófonos en red LAN sobre HTTP:"
  echo " En Chrome/Brave/Edge abre chrome://flags/#unsafely-treat-insecure-origin-as-secure,"
  echo " añade 'http://${LAN_IP}:${PORT}' y reinicia el navegador."
  echo " O ejecuta './run.sh --ssl' para habilitar HTTPS autofirmado."
fi
echo "=========================================================="

exec uvicorn app.main:app --host "$HOST" --port "$PORT" $SSL_ARGS
