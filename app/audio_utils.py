import subprocess
import shutil
import logging
from pathlib import Path
from typing import List, Dict, Any, Union

logger = logging.getLogger(__name__)


def is_ffmpeg_available() -> bool:
    """Check if ffmpeg is available in system PATH."""
    return shutil.which("ffmpeg") is not None


def convert_to_mp3(input_path: Union[str, Path], output_path: Union[str, Path]) -> str:
    """
    Convert any media file (webm, mp4, mkv, mov, wav, m4a, ogg, etc.) to 16kHz mono MP3.
    Command: ffmpeg -y -i <input> -vn -acodec libmp3lame -ac 1 -ar 16000 -b:a 128k <output.mp3>
    """
    input_path = str(input_path)
    output_path = str(output_path)

    cmd = [
        "ffmpeg",
        "-y",
        "-i", input_path,
        "-vn",
        "-acodec", "libmp3lame",
        "-ac", "1",
        "-ar", "16000",
        "-b:a", "128k",
        output_path,
    ]

    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if result.returncode != 0:
        logger.error(f"FFmpeg conversion error: {result.stderr}")
        raise RuntimeError(f"FFmpeg failed with exit code {result.returncode}: {result.stderr}")

    return output_path


def format_srt_time(seconds: float) -> str:
    """Format seconds into SRT timestamp format: HH:MM:SS,mmm"""
    if seconds < 0:
        seconds = 0.0

    total_seconds = int(seconds)
    millis = int(round((seconds - total_seconds) * 1000))
    if millis >= 1000:
        total_seconds += 1
        millis -= 1000

    hours = total_seconds // 3600
    minutes = (total_seconds % 3600) // 60
    secs = total_seconds % 60
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def format_display_time(seconds: float) -> str:
    """Format seconds into MM:SS (or HH:MM:SS if >= 1 hour)"""
    if seconds < 0:
        seconds = 0.0

    total_seconds = int(seconds)
    hours = total_seconds // 3600
    minutes = (total_seconds % 3600) // 60
    secs = total_seconds % 60

    if hours > 0:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"


def generate_srt(segments: List[Dict[str, Any]]) -> str:
    """
    Generate SubRip (.srt) subtitle content from a list of segment dictionaries.
    Each segment should have 'start', 'end', and 'text'.
    """
    srt_lines = []
    for idx, seg in enumerate(segments, start=1):
        start_time = format_srt_time(float(seg.get("start", 0.0)))
        end_time = format_srt_time(float(seg.get("end", 0.0)))
        text = str(seg.get("text", "")).strip()

        srt_lines.append(f"{idx}\n{start_time} --> {end_time}\n{text}\n")

    return "\n".join(srt_lines).strip() + "\n" if srt_lines else ""
