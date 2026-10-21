import asyncio
import ctypes
import gc
import glob
import logging
import os
import subprocess
import sys
import time
from typing import Optional, Dict, Any, List, Tuple

logger = logging.getLogger(__name__)

# Auto-discover and preload pip-installed nvidia CUDA libraries (cublas, cudnn, etc.)
def _preload_nvidia_libs():
    try:
        site_pkg_paths = [p for p in sys.path if "site-packages" in p]
        for sp in site_pkg_paths:
            nvidia_lib_dirs = glob.glob(os.path.join(sp, "nvidia", "*", "lib"))
            for d in nvidia_lib_dirs:
                if not os.path.isdir(d):
                    continue
                # Add to LD_LIBRARY_PATH if not present
                curr_ld = os.environ.get("LD_LIBRARY_PATH", "")
                if d not in curr_ld:
                    os.environ["LD_LIBRARY_PATH"] = f"{d}:{curr_ld}" if curr_ld else d
                # Preload shared libraries
                for f in sorted(os.listdir(d)):
                    if f.endswith(".so") or ".so." in f:
                        try:
                            ctypes.CDLL(os.path.join(d, f), mode=ctypes.RTLD_GLOBAL)
                        except Exception:
                            pass
    except Exception as e:
        logger.debug(f"Nvidia libs auto-preload note: {e}")

_preload_nvidia_libs()

import ctranslate2
from faster_whisper import WhisperModel

MODEL_MAP = {
    "turbo": "large-v3-turbo",
    "large-v3-turbo": "large-v3-turbo",
    "medium": "medium",
    "small": "small",
    "base": "base",
    "tiny": "tiny",
}


def get_gpu_device_name() -> Optional[str]:
    """Retrieve GPU device name via nvidia-smi if available."""
    try:
        res = subprocess.run(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=3,
        )
        if res.returncode == 0 and res.stdout.strip():
            return res.stdout.strip().split("\n")[0].strip()
    except Exception as e:
        logger.debug(f"Could not get GPU name via nvidia-smi: {e}")
    return None


class WhisperManager:
    """
    Singleton manager for Faster-Whisper to guarantee single-model VRAM residency (max 4GB VRAM)
    and synchronized single-worker transcription execution.
    """
    _instance: Optional["WhisperManager"] = None

    def __new__(cls) -> "WhisperManager":
        if cls._instance is None:
            cls._instance = super(WhisperManager, cls).__new__(cls)
            cls._instance._init_manager()
        return cls._instance

    def _init_manager(self) -> None:
        self.lock = asyncio.Lock()
        self.current_model_key: Optional[str] = None
        self.current_device: Optional[str] = None
        self.current_compute_type: Optional[str] = None
        self.model: Optional[WhisperModel] = None

    def is_cuda_available(self) -> bool:
        try:
            return ctranslate2.get_cuda_device_count() > 0
        except Exception:
            return False

    def get_device_info(self) -> Dict[str, Any]:
        cuda_avail = self.is_cuda_available()
        gpu_name = get_gpu_device_name() if cuda_avail else None
        return {
            "cuda_available": cuda_avail,
            "device_name": gpu_name or ("CUDA GPU" if cuda_avail else "CPU"),
            "loaded_model": self.current_model_key,
            "current_device": self.current_device,
        }

    def unload_model(self) -> None:
        """Unload current model and free memory/VRAM."""
        if self.model is not None:
            logger.info(f"Unloading model {self.current_model_key}")
            del self.model
            self.model = None
            self.current_model_key = None
            self.current_device = None
            self.current_compute_type = None

            gc.collect()
            try:
                import torch
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            except ImportError:
                pass

    def _load_model(self, model_key: str, force_cpu: bool = False) -> None:
        target_name = MODEL_MAP.get(model_key, model_key)
        use_cuda = self.is_cuda_available() and not force_cpu

        device = "cuda" if use_cuda else "cpu"
        compute_type = "int8_float16" if use_cuda else "int8"

        # Check if already loaded with same configuration
        if (
            self.model is not None
            and self.current_model_key == model_key
            and self.current_device == device
        ):
            return

        self.unload_model()

        try:
            logger.info(f"Loading Whisper model '{target_name}' on {device} ({compute_type})...")
            self.model = WhisperModel(
                target_name,
                device=device,
                compute_type=compute_type,
            )
            self.current_model_key = model_key
            self.current_device = device
            self.current_compute_type = compute_type
            logger.info(f"Model '{model_key}' loaded successfully on {device}.")
        except Exception as e:
            if use_cuda:
                logger.warning(
                    f"CUDA loading failed for '{target_name}' ({e}). Falling back to CPU (int8)..."
                )
                self.unload_model()
                self._load_model(model_key, force_cpu=True)
            else:
                raise e

    def transcribe(
        self,
        audio_path: str,
        model_name: str = "turbo",
        language: Optional[str] = "es",
        vad_filter: bool = True,
    ) -> Dict[str, Any]:
        """
        Synchronously transcribes the audio file.
        Should be called inside an asyncio thread or worker under self.lock.
        """
        normalized_model = model_name.lower().strip() if model_name else "turbo"
        normalized_lang = language.lower().strip() if language else None
        if normalized_lang in ("auto", "none", ""):
            normalized_lang = None

        # Ensure model is loaded
        try:
            self._load_model(normalized_model)
        except Exception as e:
            logger.error(f"Error loading model {normalized_model}: {e}")
            raise

        start_time = time.perf_counter()

        def run_transcription() -> Tuple[List[Dict[str, Any]], str, float, str]:
            assert self.model is not None
            segments_iter, info = self.model.transcribe(
                audio_path,
                language=normalized_lang,
                vad_filter=vad_filter,
                beam_size=5,
            )
            segments = []
            text_chunks = []
            for s in segments_iter:
                seg_text = s.text.strip()
                segments.append({
                    "start": round(s.start, 2),
                    "end": round(s.end, 2),
                    "text": seg_text,
                })
                text_chunks.append(seg_text)
            
            full_text = " ".join(text_chunks).strip()
            duration = round(float(info.duration), 2)
            detected_lang = info.language or (normalized_lang or "unknown")
            return segments, full_text, duration, detected_lang

        try:
            segments, full_text, duration, detected_lang = run_transcription()
        except (RuntimeError, Exception) as e:
            err_msg = str(e).lower()
            if "out of memory" in err_msg or "cuda" in err_msg or "cublas" in err_msg:
                logger.warning(f"CUDA transcription error ({e}). Retrying on CPU fallback...")
                self.unload_model()
                self._load_model(normalized_model, force_cpu=True)
                segments, full_text, duration, detected_lang = run_transcription()
            else:
                raise

        elapsed = round(time.perf_counter() - start_time, 2)

        return {
            "language": detected_lang,
            "duration_seconds": duration,
            "processing_time_seconds": elapsed,
            "text": full_text,
            "segments": segments,
        }


# Global instance
transcriber_manager = WhisperManager()
