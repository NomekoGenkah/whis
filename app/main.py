import asyncio
import json
import logging
import os
import re
import shutil
import time
from datetime import datetime
from pathlib import Path
from typing import Optional, List, Dict, Any

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.audio_utils import is_ffmpeg_available, convert_to_mp3, generate_srt
from app.transcriber import transcriber_manager

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("whis")

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
RECORDINGS_DIR = DATA_DIR / "recordings"
TRANSCRIPTS_DIR = DATA_DIR / "transcripts"
STATIC_DIR = BASE_DIR / "app" / "static"

RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)
TRANSCRIPTS_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(
    title="Whis — Grabador Web y Transcriptor Local",
    description="Grabación web y transcripción local acelerada por GPU con faster-whisper",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health_check():
    """
    Returns server health, ffmpeg status, CUDA availability and device info.
    """
    device_info = transcriber_manager.get_device_info()
    return {
        "status": "ok",
        "ffmpeg_available": is_ffmpeg_available(),
        "cuda_available": device_info["cuda_available"],
        "device_name": device_info["device_name"],
        "loaded_model": device_info["loaded_model"],
        "current_device": device_info["current_device"],
    }


@app.post("/api/transcribe")
async def transcribe_audio(
    file: UploadFile = File(...),
    model: str = Form("turbo"),
    language: str = Form("es"),
    vad_filter: bool = Form(True),
    keep_mp3: bool = Form(True),
):
    """
    Accepts an uploaded or recorded media file, converts it to 16kHz mono MP3 via ffmpeg,
    and runs transcription with faster-whisper on GPU (with CPU fallback).
    """
    if not is_ffmpeg_available():
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="FFmpeg is not installed or not found in system PATH.",
        )

    # Generate unique ID (e.g. 20261021_113045_a1b2)
    timestamp_str = datetime.now().strftime("%Y%m%d_%H%M%S")
    rand_suffix = os.urandom(2).hex()
    session_id = f"{timestamp_str}_{rand_suffix}"

    # Determine file extension
    orig_ext = Path(file.filename or "recording.webm").suffix.lower()
    if not orig_ext:
        orig_ext = ".webm"

    temp_raw_path = RECORDINGS_DIR / f"{session_id}_raw{orig_ext}"
    output_mp3_path = RECORDINGS_DIR / f"{session_id}.mp3"

    try:
        # Save uploaded file
        with open(temp_raw_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        logger.error(f"Failed to save uploaded file: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to save upload: {e}",
        )
    finally:
        file.file.close()

    # Step 2: Convert to 16kHz mono MP3 using ffmpeg
    try:
        convert_to_mp3(temp_raw_path, output_mp3_path)
    except Exception as e:
        if temp_raw_path.exists():
            temp_raw_path.unlink()
        logger.error(f"FFmpeg conversion failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Audio conversion failed: {e}",
        )
    finally:
        # Remove raw input file after conversion to save disk space
        if temp_raw_path.exists():
            temp_raw_path.unlink()

    # Step 3: Transcribe under GPU lock
    async with transcriber_manager.lock:
        try:
            result = await asyncio.to_thread(
                transcriber_manager.transcribe,
                audio_path=str(output_mp3_path),
                model_name=model,
                language=language,
                vad_filter=vad_filter,
            )
        except Exception as e:
            logger.error(f"Transcription error: {e}", exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Transcription failed: {e}",
            )

    # Step 4: Generate .txt and .srt files
    txt_path = TRANSCRIPTS_DIR / f"{session_id}.txt"
    srt_path = TRANSCRIPTS_DIR / f"{session_id}.srt"
    json_path = TRANSCRIPTS_DIR / f"{session_id}.json"

    srt_content = generate_srt(result["segments"])

    with open(txt_path, "w", encoding="utf-8") as f:
        f.write(result["text"] + "\n")

    with open(srt_path, "w", encoding="utf-8") as f:
        f.write(srt_content)

    # Handle keep_mp3 flag
    mp3_download_url = None
    if keep_mp3:
        mp3_download_url = f"/api/download/{session_id}.mp3"
    else:
        if output_mp3_path.exists():
            output_mp3_path.unlink()

    downloads = {
        "txt": f"/api/download/{session_id}.txt",
        "srt": f"/api/download/{session_id}.srt",
    }
    if mp3_download_url:
        downloads["mp3"] = mp3_download_url

    response_payload = {
        "id": session_id,
        "created_at": datetime.now().isoformat(),
        "model": model,
        "language": result["language"],
        "duration_seconds": result["duration_seconds"],
        "processing_time_seconds": result["processing_time_seconds"],
        "text": result["text"],
        "segments": result["segments"],
        "downloads": downloads,
    }

    # Save metadata JSON for history
    try:
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(response_payload, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.warning(f"Could not save transcript json metadata: {e}")

    return response_payload


@app.get("/api/download/{filename}")
async def download_file(filename: str):
    """
    Download .mp3, .txt, .srt or .json files safely without path traversal.
    """
    # Sanitize filename
    safe_filename = Path(filename).name
    if safe_filename != filename or ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")

    ext = Path(safe_filename).suffix.lower()
    if ext == ".mp3":
        file_path = RECORDINGS_DIR / safe_filename
        media_type = "audio/mpeg"
    elif ext in (".txt", ".srt", ".json"):
        file_path = TRANSCRIPTS_DIR / safe_filename
        if ext == ".txt":
            media_type = "text/plain; charset=utf-8"
        elif ext == ".srt":
            media_type = "application/x-subrip; charset=utf-8"
        else:
            media_type = "application/json; charset=utf-8"
    else:
        raise HTTPException(status_code=400, detail="Unsupported file format")

    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(
        path=str(file_path),
        filename=safe_filename,
        media_type=media_type,
    )


@app.get("/api/history")
async def get_history() -> List[Dict[str, Any]]:
    """
    Returns the last 20 transcriptions from data/transcripts/.
    """
    history = []
    json_files = sorted(
        TRANSCRIPTS_DIR.glob("*.json"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )

    for jf in json_files[:20]:
        try:
            with open(jf, "r", encoding="utf-8") as f:
                data = json.load(f)
                # Check if downloads still exist and adjust
                downloads = data.get("downloads", {})
                sid = data.get("id", jf.stem)
                mp3_file = RECORDINGS_DIR / f"{sid}.mp3"
                if not mp3_file.exists():
                    downloads.pop("mp3", None)
                data["downloads"] = downloads

                # Make preview for listing
                full_text = data.get("text", "")
                data["preview"] = (full_text[:120] + "...") if len(full_text) > 120 else full_text
                history.append(data)
        except Exception as e:
            logger.warning(f"Error reading history file {jf}: {e}")

    return history


# Mount static directory to serve index.html, app.js, styles.css
if STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
