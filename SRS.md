# Lean SRS: Whis — Grabador Web y Transcriptor Local con Faster-Whisper

## 1. Propósito del Proyecto
Reemplazar el flujo manual de tres pasos (`Grabar en OBS (.mp4)` $\rightarrow$ `Convertir en VLC (.mp3)` $\rightarrow$ `CLI Whisper`) por una aplicación web ligera auto-alojada en un servidor local (LAN).
Permite **grabar directamente desde el navegador** (mezclando micrófono + audio del sistema/reunión) o **subir archivos multimedia existentes** (`.mp4`, `.mkv`, `.mp3`, `.wav`, etc.), extrayendo el audio con `ffmpeg` y transcribiéndolo en GPU mediante `faster-whisper`.

---

## 2. Entorno de Hardware y Restricciones Críticas (Para el Agente Implementador)
* **Servidor Destino:** Linux en red local (LAN), **16 GB RAM**, GPU **NVIDIA RTX 3050 (4 GB VRAM)**.
* **Optimización obligatoria de VRAM (4 GB):**
  * El modelo por defecto `turbo` (`deepdml/faster-whisper-large-v3-turbo-ct2` o `large-v3-turbo`) en `float16` o `int8_float16` ocupa ~1.6 GB - 2.5 GB de VRAM.
  * **Regla de implementación:** Usar `device="cuda"` con `compute_type="int8_float16"` (o `float16`) por defecto, con fallback automático a `device="cpu"`, `compute_type="int8"` si CUDA falla o hay `OutOfMemory`.
  * No cargar múltiples modelos simultáneamente en VRAM. Mantener un **Singleton** del modelo cargado en memoria; si el usuario cambia de modelo en la UI, descargar el anterior (`del model`, `gc.collect()`, `torch.cuda.empty_cache()` si aplica) antes de cargar el nuevo.
  * Ejecutar una sola transcripción a la vez mediante un `asyncio.Lock()` o cola simple para no saturar los 4 GB de VRAM.

---

## 3. Stack Tecnológico (Simple y Directo)
> **Instrucción para la IA implementadora:** NO usar frameworks complejos de frontend (ni React, ni Next.js, ni pasos de compilación con npm/webpack). Todo el frontend debe ser Vanilla JS + HTML5 + CSS moderno servido directamente por FastAPI.

* **Backend:** Python 3.10+ con **FastAPI** + **Uvicorn**.
* **Motor de Transcripción:** `faster-whisper` (CTranslate2).
* **Procesamiento de Audio/Video:** `ffmpeg` (invocado vía `subprocess` para normalizar cualquier entrada `.webm`, `.mp4`, `.mkv`, `.mp3` a WAV 16kHz mono o MP3 antes de transcribir/exportar).
* **Frontend:** Single Page Application en **HTML5 + Vanilla JavaScript + PicoCSS o Tailwind CDN** (servido en `/`).
* **Persistencia:** Sistema de archivos local (`./data/uploads` y `./data/outputs`) o base de datos `sqlite3` mínima opcional para historial de sesiones.

---

## 4. Arquitectura y Estructura de Archivos

```text
whis/
├── app/
│   ├── __init__.py
│   ├── main.py              # Endpoints FastAPI y montaje de archivos estáticos
│   ├── transcriber.py       # Singleton de Faster-Whisper y gestión de VRAM
│   ├── audio_utils.py       # Funciones con ffmpeg (extracción MP4->MP3/WAV)
│   └── static/
│       ├── index.html       # Interfaz de usuario única
│       ├── styles.css       # Estilos limpios (modo oscuro por defecto)
│       └── app.js           # Lógica de Web Audio API, grabación y llamadas fetch
├── data/
│   ├── recordings/          # Audios procesados (.mp3)
│   └── transcripts/         # Resultados (.txt, .srt, .json)
├── requirements.txt
└── README.md                # Instrucciones de despliegue y configuración LAN/HTTPS
```

---

## 5. Requerimientos Funcionales

### RF-01: Grabación Web con Mezcla de Audio (Micrófono + Sistema)
El navegador debe permitir grabar una reunión sin depender de OBS:
1. **Selector de Micrófono:** Desplegable (`<select>`) poblado con `navigator.mediaDevices.enumerateDevices()` filtrando `audioinput`.
2. **Botón "🔄 Actualizar Dispositivos":** Re-ejecuta `enumerateDevices()` sin recargar la página para detectar micrófonos o auriculares recién conectados.
3. **Toggle "Incluir Audio del Sistema / Pestaña":**
   * Cuando está activo, al iniciar la grabación solicita `navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })` (necesario en navegadores para capturar audio de escritorio/pestaña) y descarta los frames de video inmediatamente (`videoTrack.stop()`), conservando solo el `audioTrack` del sistema.
4. **Mezclador Web Audio API (`AudioContext`):**
   * Crea un `AudioContext` y un `MediaStreamAudioDestinationNode`.
   * Conecta la fuente del micrófono (`getUserMedia`) y, si fue seleccionada, la fuente del sistema (`getDisplayMedia`) al mismo nodo destino.
   * Graba el stream combinado usando `MediaRecorder` (en `audio/webm;codecs=opus` o el formato nativo soportado por el navegador).
5. **Controles de Grabación:**
   * Botones `Iniciar Grabación`, `Pausar/Reanudar` y `Detener`.
   * Temporizador en vivo (`00:00:00`) e indicador visual de nivel de volumen (vúmetro simple con `AnalyserNode` para confirmar que entra audio antes de hablar 1 hora).
   * Al detener, permite: **(a) Descargar el audio inmediatamente** o **(b) Enviarlo directo a transcribir**.

### RF-02: Subida de Archivos Existentes (Drag & Drop)
Para cuando el usuario ya grabó algo con OBS u otra herramienta:
1. Zona de arrastrar y soltar que acepte `.mp4`, `.mkv`, `.mov`, `.webm`, `.mp3`, `.wav`, `.m4a`, `.ogg`.
2. El backend recibe el archivo y extrae automáticamente la pista de audio con `ffmpeg` sin intervención manual en VLC.

### RF-03: Parámetros Configurables de Transcripción (Whisper)
Formulario visible antes de procesar (con valores por defecto pensados para el flujo habitual del usuario):
* **Modelo (`model`):**
  * `turbo` *(Por defecto — mapeado a `deepdml/faster-whisper-large-v3-turbo-ct2` o `large-v3-turbo`)*
  * `medium`
  * `small`
  * `base`
* **Idioma (`language`):**
  * `es` *(Español — Por defecto)*
  * `en` *(Inglés)*
  * `auto` *(Detección automática -> `language=None` en faster-whisper)*
* **Filtro de Silencios (`vad_filter`):** Checkbox activado por defecto (`True`). Usa Silero VAD integrado en `faster-whisper` para saltar silencios largos de reuniones y evitar alucinaciones de Whisper.
* **Formato de Audio Guardado:** Opción para conservar el archivo de audio convertido en `.mp3` (por defecto `192k`).

### RF-04: Visualización y Exportación de Resultados
Una vez terminada la transcripción:
1. **Área de texto editable/copiable:** Muestra el texto plano completo y un botón **"📋 Copiar todo"**.
2. **Vista con marcas de tiempo (Timestamps):** Muestra `[MM:SS -> MM:SS] Texto...` opcional mediante un switch.
3. **Botones de Descarga Directa:**
   * Descargar `.txt` (solo texto limpio).
   * Descargar `.srt` (subtítulos con tiempos).
   * Descargar `.mp3` (el audio extraído/mezclado ya convertido por `ffmpeg`).

---

## 6. Especificación de la API (Backend FastAPI)

### `GET /api/health`
Devuelve el estado del servidor, si `ffmpeg` está instalado y si CUDA (RTX 3050) está disponible.
```json
{
  "status": "ok",
  "cuda_available": true,
  "device_name": "NVIDIA GeForce RTX 3050",
  "loaded_model": "turbo"
}
```

### `POST /api/transcribe`
Recibe un `multipart/form-data`:
* `file`: Archivo binario (`.webm` grabado en el navegador, o `.mp4`/`.mp3` subido).
* `model`: `string` (default: `"turbo"`).
* `language`: `string` (default: `"es"`, si es `"auto"` pasar `None`).
* `vad_filter`: `bool` (default: `true`).
* `keep_mp3`: `bool` (default: `true`).

**Flujo interno del Endpoint:**
1. Guarda el archivo temporal en `/data/recordings/`.
2. Ejecuta `ffmpeg -y -i <input> -vn -acodec libmp3lame -ac 1 -ar 16000 -b:a 128k <output.mp3>` (extrae el audio de `.mp4` o convierte el `.webm` del navegador a un `.mp3` ligero mono a 16kHz ideal para Whisper y descargable por el usuario).
3. Adquiere el lock de GPU y llama a `transcriber.transcribe(mp3_path, model, language, vad_filter)`.
4. Genera los contenidos `.txt` y `.srt`, los guarda en `/data/transcripts/` con un ID/timestamp único.
5. Retorna JSON:
```json
{
  "id": "20261021_083015",
  "language": "es",
  "duration_seconds": 1420.5,
  "processing_time_seconds": 38.2,
  "text": "Texto completo unido...",
  "segments": [
    {"start": 0.0, "end": 4.2, "text": "Hola a todos en la reunión..."}
  ],
  "downloads": {
    "mp3": "/api/download/20261021_083015.mp3",
    "txt": "/api/download/20261021_083015.txt",
    "srt": "/api/download/20261021_083015.srt"
  }
}
```

### `GET /api/download/{filename}`
Sirve el archivo `.mp3`, `.txt` o `.srt` con `FileResponse` para descarga directa.

### `GET /api/history`
Lista las últimas 20 grabaciones/transcripciones guardadas en `data/` por si se cerró la pestaña por accidente.

---

## 7. Nota Técnica Crucial: Acceso en Red Local (LAN) y Permisos de Micrófono

Los navegadores modernos bloquean `navigator.mediaDevices.getUserMedia` y `getDisplayMedia` en orígenes HTTP que no sean `localhost` (por ejemplo, al entrar a `http://192.168.1.50:8000`).

El proyecto debe incluir **dos soluciones simples** documentadas en el `README.md` y en el script de inicio:
1. **Opción 1 (Cero configuración en servidor — Flag en navegador del cliente):**
   En Chrome/Brave/Edge del PC desde donde se accede, abrir `chrome://flags/#unsafely-treat-insecure-origin-as-secure`, añadir `http://<IP_DEL_SERVIDOR>:8000` y reiniciar el navegador.
2. **Opción 2 (Certificado autofirmado automático en Uvicorn):**
   Incluir un pequeño script `run.sh` que genere un certificado autofirmado (`openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes -subj "/CN=whis.local"`) si no existe, permitiendo levantar Uvicorn con `--ssl-keyfile key.pem --ssl-certfile cert.pem` si el usuario lo desea.

---

## 8. Plan de Implementación Paso a Paso (Checklist para la IA Implementadora)

1. **Paso 1 (`requirements.txt` y dependencias):**
   * Crear `requirements.txt` con `fastapi`, `uvicorn[standard]`, `python-multipart`, `faster-whisper`, `pydantic`.
   * Verificar que `ffmpeg` esté instalado en el sistema operativo.
2. **Paso 2 (`app/audio_utils.py`):**
   * Implementar función `convert_to_mp3(input_path, output_path)` usando `subprocess.run(["ffmpeg", ...])`.
   * Implementar generador de formato `.srt` a partir de los segmentos de `faster-whisper`.
3. **Paso 3 (`app/transcriber.py`):**
   * Implementar clase `WhisperManager` que mapee `"turbo"` a `"deepdml/faster-whisper-large-v3-turbo-ct2"` (o `"large-v3-turbo"` según versión de `faster-whisper` >= 1.1.0).
   * Configurar `device="cuda"`, `compute_type="int8_float16"` con fallback a CPU si no detecta librerías CUDA (`cublas`/`cudnn`).
4. **Paso 4 (`app/main.py`):**
   * Crear endpoints `/api/health`, `/api/transcribe`, `/api/history`, `/api/download/{filename}` y servir `app/static` en `/`.
5. **Paso 5 (`app/static/`):**
   * Construir UI limpia de una sola pantalla con dos pestañas o paneles: **"🎙️ Grabar Ahora"** y **"📁 Subir Archivo (.mp4/.mp3)"**.
   * Implementar selector de micrófono, botón de refrescar dispositivos, checkbox de audio de sistema, vúmetro en canvas/barra CSS, selector de modelo (`turbo` default) e idioma (`es` default).
6. **Paso 6 (`run.sh` y `README.md`):**
   * Crear script de arranque y documentación de dependencias CUDA/FFmpeg.
