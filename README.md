# Whis — Grabador Web y Transcriptor Local con Faster-Whisper

**Whis** es una aplicación web ligera y auto-alojada para servidores locales (LAN) que reemplaza por completo el flujo manual de tres pasos (`Grabar en OBS (.mp4)` $\rightarrow$ `Convertir en VLC (.mp3)` $\rightarrow$ `CLI Whisper`).

Permite **grabar directamente desde el navegador** (mezclando micrófono y audio del sistema/reunión con Web Audio API) o **subir archivos multimedia existentes** (`.mp4`, `.mkv`, `.mov`, `.webm`, `.mp3`, `.wav`, `.m4a`, etc.), extrayendo el audio con `ffmpeg` y transcribiéndolo en GPU con aceleración CTranslate2 y `faster-whisper`.

---

## ⚡ Características Principales

* **Mezcla de Audio en el Navegador (Web Audio API):**
  * Graba el micrófono seleccionado junto con el audio del sistema o de la reunión (pestaña/escritorio) en una única pista sincronizada.
  * Selector dinámico de micrófono y botón de actualización en caliente de dispositivos de audio.
  * Vúmetro visual en tiempo real para verificar niveles de entrada antes y durante la grabación.
  * Temporizador de grabación en vivo con controles de Pausa, Reanudar y Detener.
* **Subida Directa (Drag & Drop):**
  * Arrastra cualquier archivo `.mp4`, `.mkv`, `.webm`, `.mp3`, `.wav`, etc.
  * Conversión automática y transparente con `ffmpeg` a MP3 mono a 16 kHz optimizado para Whisper.
* **Optimizado para GPU de 4 GB VRAM (RTX 3050):**
  * Modelo predeterminado: `turbo` (`large-v3-turbo`) en cuantización `int8_float16` / `float16`.
  * Patrón **Singleton** con gestión estricta de memoria (solo un modelo cargado a la vez).
  * Cola / bloqueo asíncrono para ejecutar una sola transcripción simultánea en GPU.
  * **Fallback automático a CPU** (`compute_type="int8"`) si ocurre `OutOfMemory` o fallan librerías CUDA.
  * Filtro de silencios **Silero VAD** activado por defecto para ignorar pausas y prevenir alucinaciones.
* **Visualización y Exportación Inmediata:**
  * Editor / visor de texto plano con botón de copiado rápido al portapapeles.
  * Alternador de vista con marcas de tiempo (`[MM:SS -> MM:SS]`).
  * Descargas directas en un clic: `.txt`, `.srt` (subtítulos) y `.mp3` normalizado.
* **Historial de Sesiones:**
  * Recupera las últimas 20 transcripciones realizadas por si se cerró la pestaña por error.
* **Sin frameworks frontend pesados:**
  * Frontend 100% Vanilla JS, HTML5 y CSS moderno en modo oscuro, servido directamente por FastAPI.

---

## 🛠️ Requisitos Previos

* **Sistema Operativo:** Linux (Ubuntu/Debian, Arch, Fedora, etc.)
* **Python:** 3.10 o superior (recomendado 3.11+)
* **FFmpeg:** Instalado y accesible en el `PATH` del sistema.
* **GPU (Opcional pero recomendado):** NVIDIA RTX (ej. RTX 3050 con 4 GB VRAM) con controladores instalados.

---

## 🚀 Instalación y Puesta en Marcha

### 1. Clonar el repositorio
```bash
git clone https://github.com/NomekoGenkah/whis.git
cd whis
```

### 2. Crear entorno virtual e instalar dependencias
Con `uv` (recomendado):
```bash
uv venv --python 3.11 .venv
source .venv/bin/activate
uv pip install -r requirements.txt
```

O con `pip` estándar:
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 3. Iniciar el servidor

#### Modo Estándar (HTTP):
```bash
./run.sh
```
El servidor arrancará en `http://0.0.0.0:8000`.

#### Modo Seguro (HTTPS con certificado autofirmado):
```bash
./run.sh --ssl
```
Generará automáticamente `key.pem` y `cert.pem` si no existen y levantará Uvicorn sobre HTTPS.

---

## 🔒 Acceso en Red Local (LAN) y Permisos de Micrófono

Por seguridad, los navegadores modernos (Chrome, Edge, Brave) bloquean `navigator.mediaDevices.getUserMedia` en orígenes HTTP que no sean `localhost` (ej. `http://192.168.1.10:8000`).

Tienes dos soluciones muy sencillas:

### Opción 1: Habilitar Flag en el Navegador Cliente (Recomendada si usas HTTP)
1. En tu navegador del PC cliente (Chrome, Brave, Edge), abre:
   ```text
   chrome://flags/#unsafely-treat-insecure-origin-as-secure
   ```
2. Activa la flag (*Enabled*) e introduce la dirección IP del servidor Whis:
   ```text
   http://192.168.1.10:8000
   ```
3. Reinicia el navegador. El micrófono y la captura de pantalla funcionarán inmediatamente sin alertas de certificado.

### Opción 2: Usar HTTPS con el script de inicio
1. Inicia en el servidor:
   ```bash
   ./run.sh --ssl
   ```
2. Abre en tu navegador `https://192.168.1.10:8000` y haz clic en *Avanzado* $\rightarrow$ *Continuar (sitio no seguro)* para aceptar el certificado autofirmado.

---

## 🌐 Endpoints de la API

| Método | Endpoint | Descripción |
|---|---|---|
| `GET` | `/api/health` | Estado del servidor, FFmpeg, disponibilidad de CUDA y modelo cargado. |
| `POST` | `/api/transcribe` | Sube archivo multimedia, convierte a MP3 y transcribe con Whisper. |
| `GET` | `/api/download/{filename}` | Descarga archivos `.mp3`, `.txt`, `.srt` o `.json`. |
| `GET` | `/api/history` | Devuelve las últimas 20 transcripciones guardadas. |
| `GET` | `/` | Interfaz web SPA (HTML/CSS/JS). |

---

## 🧪 Pruebas Unitarias e Integración

Para ejecutar la suite de pruebas automatizadas:
```bash
PYTHONPATH=. .venv/bin/pytest -v tests/
```

---

## 📄 Licencia

Este proyecto está bajo la Licencia MIT. Consulta el archivo [LICENSE](file:///home/genkah/dev/whis/LICENSE) para más detalles.
