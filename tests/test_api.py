import os
import subprocess
import pytest
from fastapi.testclient import TestClient
from app.main import app, RECORDINGS_DIR, TRANSCRIPTS_DIR

client = TestClient(app)

@pytest.fixture(scope="session")
def sample_wav(tmp_path_factory):
    """Generate a 1-second sine wave audio file for transcription testing."""
    fn = tmp_path_factory.mktemp("audio") / "sample.wav"
    subprocess.run([
        "ffmpeg", "-y", "-f", "lavfi", "-i", "sine=frequency=1000:duration=1",
        "-ar", "16000", "-ac", "1", str(fn)
    ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return str(fn)


def test_health_check():
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "cuda_available" in data
    assert "ffmpeg_available" in data
    assert data["ffmpeg_available"] is True


def test_root_serves_html():
    response = client.get("/")
    assert response.status_code == 200
    assert "<title>Whis" in response.text
    assert "Whisper" in response.text


def test_transcribe_flow(sample_wav):
    with open(sample_wav, "rb") as f:
        response = client.post(
            "/api/transcribe",
            files={"file": ("sample.wav", f, "audio/wav")},
            data={
                "model": "tiny",  # Use tiny for quick test execution
                "language": "es",
                "vad_filter": "false",
                "keep_mp3": "true",
            },
        )

    assert response.status_code == 200
    data = response.json()
    assert "id" in data
    assert "text" in data
    assert "segments" in data
    assert "downloads" in data
    assert "mp3" in data["downloads"]
    assert "txt" in data["downloads"]
    assert "srt" in data["downloads"]

    session_id = data["id"]

    # Verify download of text
    txt_res = client.get(f"/api/download/{session_id}.txt")
    assert txt_res.status_code == 200

    # Verify download of srt
    srt_res = client.get(f"/api/download/{session_id}.srt")
    assert srt_res.status_code == 200

    # Verify download of mp3
    mp3_res = client.get(f"/api/download/{session_id}.mp3")
    assert mp3_res.status_code == 200
    assert mp3_res.headers["content-type"] == "audio/mpeg"


def test_history():
    response = client.get("/api/history")
    assert response.status_code == 200
    items = response.json()
    assert isinstance(items, list)
    assert len(items) >= 1
    assert "preview" in items[0]


def test_download_security():
    # Attempt directory traversal
    res = client.get("/api/download/..%2F..%2Fetc%2Fpasswd")
    assert res.status_code in (400, 404)

    res = client.get("/api/download/non_existent.txt")
    assert res.status_code == 404

    res = client.get("/api/download/invalid_ext.exe")
    assert res.status_code == 400
