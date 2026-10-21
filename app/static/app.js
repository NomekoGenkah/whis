/**
 * Whis — Grabador Web y Transcriptor Local
 * Frontend Vanilla JS con Web Audio API, MediaRecorder y Fetch API.
 */

document.addEventListener("DOMContentLoaded", () => {
  // --- DOM Elements ---
  const serverStatusBadge = document.getElementById("serverStatusBadge");
  const statusIndicator = document.getElementById("statusIndicator");
  const statusText = document.getElementById("statusText");
  const securityWarning = document.getElementById("securityWarning");

  // Tabs
  const tabButtons = document.querySelectorAll(".tab-btn");
  const tabContents = document.querySelectorAll(".tab-content");

  // Global Settings
  const modelSelect = document.getElementById("modelSelect");
  const langSelect = document.getElementById("langSelect");
  const vadFilterCheck = document.getElementById("vadFilterCheck");
  const keepMp3Check = document.getElementById("keepMp3Check");

  // Recording tab
  const micSelect = document.getElementById("micSelect");
  const refreshDevicesBtn = document.getElementById("refreshDevicesBtn");
  const includeSystemAudio = document.getElementById("includeSystemAudio");
  const recordTimer = document.getElementById("recordTimer");
  const vuMeterBar = document.getElementById("vuMeterBar");
  const recordingBadge = document.getElementById("recordingBadge");
  const startRecordBtn = document.getElementById("startRecordBtn");
  const pauseRecordBtn = document.getElementById("pauseRecordBtn");
  const resumeRecordBtn = document.getElementById("resumeRecordBtn");
  const stopRecordBtn = document.getElementById("stopRecordBtn");
  const postRecordPanel = document.getElementById("postRecordPanel");
  const recordedAudioPreview = document.getElementById("recordedAudioPreview");
  const downloadRawRecordBtn = document.getElementById("downloadRawRecordBtn");
  const transcribeRecordedBtn = document.getElementById("transcribeRecordedBtn");
  const discardRecordBtn = document.getElementById("discardRecordBtn");

  // Upload tab
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("fileInput");
  const selectedFileInfo = document.getElementById("selectedFileInfo");
  const fileNameLabel = document.getElementById("fileNameLabel");
  const fileSizeLabel = document.getElementById("fileSizeLabel");
  const transcribeUploadedBtn = document.getElementById("transcribeUploadedBtn");
  const clearFileBtn = document.getElementById("clearFileBtn");

  // History tab
  const historyList = document.getElementById("historyList");
  const historyCount = document.getElementById("historyCount");
  const refreshHistoryBtn = document.getElementById("refreshHistoryBtn");

  // Processing & Results
  const processingCard = document.getElementById("processingCard");
  const processingStatusText = document.getElementById("processingStatusText");
  const processingTimer = document.getElementById("processingTimer");
  const resultCard = document.getElementById("resultCard");
  const resultMeta = document.getElementById("resultMeta");
  const plainTextView = document.getElementById("plainTextView");
  const timestampView = document.getElementById("timestampView");
  const showTimestampsCheck = document.getElementById("showTimestampsCheck");
  const copyTextBtn = document.getElementById("copyTextBtn");
  const downloadButtons = document.getElementById("downloadButtons");

  // --- State Variables ---
  let audioContext = null;
  let micStream = null;
  let systemStream = null;
  let combinedStream = null;
  let mediaRecorder = null;
  let recordedChunks = [];
  let recordedBlob = null;
  let recordTimerInterval = null;
  let recordSeconds = 0;
  let vuMeterAnimId = null;
  let analyserNode = null;

  let selectedUploadFile = null;
  let processingTimerInterval = null;
  let currentResultData = null;

  // --- Initialize ---
  checkHealth();
  checkMediaPermissionsSupport();
  setupTabs();
  setupRecordingControls();
  setupUploadZone();
  setupResultView();
  fetchHistory();

  // Periodically check health every 20 seconds
  setInterval(checkHealth, 20000);

  // ==========================================
  // Health & Server Status
  // ==========================================
  async function checkHealth() {
    try {
      const res = await fetch("/api/health");
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();

      statusIndicator.className = "status-indicator online";
      let label = "Online";
      if (data.cuda_available) {
        label += ` · GPU (${data.device_name || "CUDA"})`;
      } else {
        label += " · CPU";
      }
      if (data.loaded_model) {
        label += ` [${data.loaded_model}]`;
      }
      statusText.textContent = label;
      serverStatusBadge.title = `FFmpeg: ${data.ffmpeg_available ? "OK" : "No detectado"} | CUDA: ${data.cuda_available}`;
    } catch (e) {
      statusIndicator.className = "status-indicator offline";
      statusText.textContent = "Desconectado";
      serverStatusBadge.title = "No se puede conectar con el backend de Whis";
    }
  }

  function checkMediaPermissionsSupport() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      securityWarning.style.display = "flex";
    }
  }

  // ==========================================
  // Tabs Navigation
  // ==========================================
  function setupTabs() {
    tabButtons.forEach(btn => {
      btn.addEventListener("click", () => {
        tabButtons.forEach(b => b.classList.remove("active"));
        tabContents.forEach(c => c.classList.remove("active"));
        btn.classList.add("active");
        const tabId = btn.getAttribute("data-tab");
        const content = document.getElementById(tabId);
        if (content) content.classList.add("active");
        if (tabId === "history-tab") {
          fetchHistory();
        }
      });
    });
  }

  // ==========================================
  // RF-01: Grabación Web con Web Audio API
  // ==========================================
  async function enumerateMicrophones() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      micSelect.innerHTML = `<option value="">Micrófono predeterminado</option>`;
      return;
    }

    try {
      // First ensure permission prompt has run or request devices
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(d => d.kind === "audioinput");

      micSelect.innerHTML = "";
      if (audioInputs.length === 0) {
        micSelect.innerHTML = `<option value="">Micrófono predeterminado (o sin permiso)</option>`;
        return;
      }

      audioInputs.forEach((device, idx) => {
        const option = document.createElement("option");
        option.value = device.deviceId;
        option.textContent = device.label || `Micrófono ${idx + 1}`;
        micSelect.appendChild(option);
      });
    } catch (err) {
      console.warn("Error enumerating devices:", err);
      micSelect.innerHTML = `<option value="">Micrófono predeterminado</option>`;
    }
  }

  refreshDevicesBtn.addEventListener("click", async () => {
    refreshDevicesBtn.disabled = true;
    refreshDevicesBtn.textContent = "🔄 Buscando...";
    try {
      // Try asking permission if labels are empty
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
          const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          tempStream.getTracks().forEach(t => t.stop());
        } catch (_) {}
      }
      await enumerateMicrophones();
    } finally {
      refreshDevicesBtn.disabled = false;
      refreshDevicesBtn.textContent = "🔄 Actualizar";
    }
  });

  // Try initial enumeration
  enumerateMicrophones();

  function setupRecordingControls() {
    startRecordBtn.addEventListener("click", startRecording);
    pauseRecordBtn.addEventListener("click", pauseRecording);
    resumeRecordBtn.addEventListener("click", resumeRecording);
    stopRecordBtn.addEventListener("click", stopRecording);

    downloadRawRecordBtn.addEventListener("click", () => {
      if (!recordedBlob) return;
      const url = URL.createObjectURL(recordedBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `grabacion_${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "")}.webm`;
      a.click();
      URL.revokeObjectURL(url);
    });

    transcribeRecordedBtn.addEventListener("click", () => {
      if (!recordedBlob) return;
      const filename = `recording_${Date.now()}.webm`;
      const file = new File([recordedBlob], filename, { type: recordedBlob.type || "audio/webm" });
      sendToTranscribe(file);
    });

    discardRecordBtn.addEventListener("click", () => {
      if (confirm("¿Descartar esta grabación?")) {
        resetRecordingState();
      }
    });
  }

  async function startRecording() {
    try {
      // 1. Check browser capabilities
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert("Tu navegador no soporta grabación de audio en este origen HTTP. Revisa el aviso superior.");
        return;
      }

      postRecordPanel.style.display = "none";
      recordedBlob = null;
      recordedChunks = [];

      // 2. Web Audio API Context
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      audioContext = new AudioCtxClass();
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      const destinationNode = audioContext.createMediaStreamDestination();

      // 3. Microphone stream
      const selectedMicId = micSelect.value;
      const micConstraints = {
        audio: selectedMicId ? { deviceId: { exact: selectedMicId } } : true,
      };

      micStream = await navigator.mediaDevices.getUserMedia(micConstraints);
      // Re-enumerate to get device labels now that permission was granted
      enumerateMicrophones();

      const micSource = audioContext.createMediaStreamSource(micStream);
      micSource.connect(destinationNode);

      // 4. System / Tab audio (if enabled)
      if (includeSystemAudio.checked) {
        if (!navigator.mediaDevices.getDisplayMedia) {
          alert("La captura de audio de pantalla/pestaña no está soportada en este navegador.");
        } else {
          try {
            systemStream = await navigator.mediaDevices.getDisplayMedia({
              video: true,
              audio: true,
            });

            // Discard video track immediately to save CPU/memory
            systemStream.getVideoTracks().forEach(track => track.stop());

            const systemAudioTracks = systemStream.getAudioTracks();
            if (systemAudioTracks.length > 0) {
              const systemSource = audioContext.createMediaStreamSource(
                new MediaStream(systemAudioTracks)
              );
              systemSource.connect(destinationNode);

              // Listen for when user stops sharing tab/screen from browser banner
              systemAudioTracks[0].addEventListener("ended", () => {
                console.info("Pista de audio del sistema detenida por el usuario.");
              });
            } else {
              alert("Aviso: No se seleccionó la opción 'Compartir audio' en la ventana de captura. Solo se grabará el micrófono.");
            }
          } catch (displayErr) {
            console.warn("Captura de pantalla cancelada o denegada:", displayErr);
            // Continue recording with mic only
          }
        }
      }

      // 5. Setup Analyser for VU Meter
      analyserNode = audioContext.createAnalyser();
      analyserNode.fftSize = 256;
      destinationNode.connect(analyserNode);
      startVuMeter();

      // 6. Setup MediaRecorder with combined audio stream
      combinedStream = destinationNode.stream;

      let mimeType = "audio/webm;codecs=opus";
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
      }

      mediaRecorder = new MediaRecorder(combinedStream, mimeType ? { mimeType } : undefined);

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          recordedChunks.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        const finalType = mediaRecorder.mimeType || "audio/webm";
        recordedBlob = new Blob(recordedChunks, { type: finalType });
        recordedAudioPreview.src = URL.createObjectURL(recordedBlob);
        postRecordPanel.style.display = "block";
      };

      // Start recording with 1 second timeslice
      mediaRecorder.start(1000);

      // UI state
      startRecordBtn.style.display = "none";
      pauseRecordBtn.style.display = "inline-flex";
      resumeRecordBtn.style.display = "none";
      stopRecordBtn.style.display = "inline-flex";
      recordingBadge.className = "recording-state-badge active";
      recordingBadge.textContent = "Grabando...";

      // Timer
      recordSeconds = 0;
      updateTimerDisplay();
      recordTimerInterval = setInterval(() => {
        recordSeconds++;
        updateTimerDisplay();
      }, 1000);

    } catch (err) {
      console.error("Error al iniciar grabación:", err);
      alert(`No se pudo iniciar la grabación: ${err.message || err.name}`);
      cleanupAudioContext();
    }
  }

  function pauseRecording() {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.pause();
      clearInterval(recordTimerInterval);
      pauseRecordBtn.style.display = "none";
      resumeRecordBtn.style.display = "inline-flex";
      recordingBadge.className = "recording-state-badge paused";
      recordingBadge.textContent = "Pausado";
    }
  }

  function resumeRecording() {
    if (mediaRecorder && mediaRecorder.state === "paused") {
      mediaRecorder.resume();
      recordTimerInterval = setInterval(() => {
        recordSeconds++;
        updateTimerDisplay();
      }, 1000);
      resumeRecordBtn.style.display = "none";
      pauseRecordBtn.style.display = "inline-flex";
      recordingBadge.className = "recording-state-badge active";
      recordingBadge.textContent = "Grabando...";
    }
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }
    clearInterval(recordTimerInterval);
    stopVuMeter();
    cleanupAudioTracks();

    // UI state
    startRecordBtn.style.display = "inline-flex";
    pauseRecordBtn.style.display = "none";
    resumeRecordBtn.style.display = "none";
    stopRecordBtn.style.display = "none";
    recordingBadge.className = "recording-state-badge";
    recordingBadge.textContent = "Completado";
  }

  function resetRecordingState() {
    stopRecording();
    postRecordPanel.style.display = "none";
    recordedBlob = null;
    recordedChunks = [];
    recordedAudioPreview.src = "";
    recordSeconds = 0;
    updateTimerDisplay();
    recordingBadge.textContent = "Inactivo";
    vuMeterBar.style.width = "0%";
  }

  function cleanupAudioTracks() {
    if (micStream) {
      micStream.getTracks().forEach(t => t.stop());
      micStream = null;
    }
    if (systemStream) {
      systemStream.getTracks().forEach(t => t.stop());
      systemStream = null;
    }
  }

  function cleanupAudioContext() {
    cleanupAudioTracks();
    stopVuMeter();
    if (audioContext && audioContext.state !== "closed") {
      audioContext.close();
      audioContext = null;
    }
  }

  function updateTimerDisplay() {
    const hours = Math.floor(recordSeconds / 3600);
    const minutes = Math.floor((recordSeconds % 3600) / 60);
    const secs = recordSeconds % 60;
    recordTimer.textContent = [
      hours.toString().padStart(2, "0"),
      minutes.toString().padStart(2, "0"),
      secs.toString().padStart(2, "0"),
    ].join(":");
  }

  function startVuMeter() {
    if (!analyserNode) return;
    const dataArray = new Uint8Array(analyserNode.frequencyBinCount);

    function draw() {
      analyserNode.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const average = sum / dataArray.length;
      // Map 0-255 to percentage with a slight boost for visual sensitivity
      const percentage = Math.min(100, Math.round((average / 128) * 100));
      vuMeterBar.style.width = `${percentage}%`;
      vuMeterAnimId = requestAnimationFrame(draw);
    }
    vuMeterAnimId = requestAnimationFrame(draw);
  }

  function stopVuMeter() {
    if (vuMeterAnimId) {
      cancelAnimationFrame(vuMeterAnimId);
      vuMeterAnimId = null;
    }
    vuMeterBar.style.width = "0%";
  }

  // ==========================================
  // RF-02: Subida de Archivos (Drag & Drop)
  // ==========================================
  function setupUploadZone() {
    dropzone.addEventListener("click", () => fileInput.click());

    ["dragenter", "dragover"].forEach(eventName => {
      dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.add("dragover");
      });
    });

    ["dragleave", "drop"].forEach(eventName => {
      dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove("dragover");
      });
    });

    dropzone.addEventListener("drop", (e) => {
      if (e.dataTransfer && e.dataTransfer.files.length > 0) {
        handleFileSelected(e.dataTransfer.files[0]);
      }
    });

    fileInput.addEventListener("change", () => {
      if (fileInput.files.length > 0) {
        handleFileSelected(fileInput.files[0]);
      }
    });

    clearFileBtn.addEventListener("click", () => {
      selectedUploadFile = null;
      fileInput.value = "";
      selectedFileInfo.style.display = "none";
      dropzone.style.display = "block";
    });

    transcribeUploadedBtn.addEventListener("click", () => {
      if (selectedUploadFile) {
        sendToTranscribe(selectedUploadFile);
      }
    });
  }

  function handleFileSelected(file) {
    selectedUploadFile = file;
    fileNameLabel.textContent = file.name;
    fileSizeLabel.textContent = formatBytes(file.size);
    selectedFileInfo.style.display = "flex";
    dropzone.style.display = "none";
  }

  function formatBytes(bytes) {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }

  // ==========================================
  // Transcripción y Comunicación con API
  // ==========================================
  async function sendToTranscribe(file) {
    // Show processing banner
    resultCard.style.display = "none";
    processingCard.style.display = "flex";
    processingStatusText.textContent = `Extrayendo audio con FFmpeg y transcribiendo (${modelSelect.value})...`;
    
    // Start processing timer
    let procSeconds = 0;
    processingTimer.textContent = "00:00";
    clearInterval(processingTimerInterval);
    processingTimerInterval = setInterval(() => {
      procSeconds++;
      const m = Math.floor(procSeconds / 60).toString().padStart(2, "0");
      const s = (procSeconds % 60).toString().padStart(2, "0");
      processingTimer.textContent = `${m}:${s}`;
    }, 1000);

    // Prepare FormData
    const formData = new FormData();
    formData.append("file", file);
    formData.append("model", modelSelect.value);
    formData.append("language", langSelect.value);
    formData.append("vad_filter", vadFilterCheck.checked ? "true" : "false");
    formData.append("keep_mp3", keepMp3Check.checked ? "true" : "false");

    try {
      const response = await fetch("/api/transcribe", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        let errDetail = "Error en el servidor al transcribir";
        try {
          const errData = await response.json();
          errDetail = errData.detail || errDetail;
        } catch (_) {}
        throw new Error(errDetail);
      }

      const data = await response.json();
      displayResult(data);
      fetchHistory();
      checkHealth();
    } catch (err) {
      console.error("Error al procesar transcripción:", err);
      alert(`Error al procesar la transcripción:\n${err.message}`);
    } finally {
      clearInterval(processingTimerInterval);
      processingCard.style.display = "none";
    }
  }

  // ==========================================
  // RF-04: Visualización y Exportación de Resultados
  // ==========================================
  function setupResultView() {
    showTimestampsCheck.addEventListener("change", () => {
      if (showTimestampsCheck.checked) {
        plainTextView.style.display = "none";
        timestampView.style.display = "flex";
      } else {
        plainTextView.style.display = "block";
        timestampView.style.display = "none";
      }
    });

    copyTextBtn.addEventListener("click", () => {
      let textToCopy = "";
      if (showTimestampsCheck.checked && currentResultData) {
        textToCopy = currentResultData.segments
          .map(s => `[${formatTimeDisplay(s.start)} -> ${formatTimeDisplay(s.end)}] ${s.text}`)
          .join("\n");
      } else {
        textToCopy = plainTextView.innerText;
      }

      navigator.clipboard.writeText(textToCopy).then(() => {
        const origText = copyTextBtn.textContent;
        copyTextBtn.textContent = "✅ ¡Copiado!";
        setTimeout(() => {
          copyTextBtn.textContent = origText;
        }, 2000);
      }).catch(err => {
        alert("No se pudo copiar al portapapeles: " + err);
      });
    });
  }

  function displayResult(data) {
    currentResultData = data;
    resultCard.style.display = "block";

    // Meta details
    const durMin = (data.duration_seconds / 60).toFixed(1);
    resultMeta.innerHTML = `
      <span class="result-meta-item">ID: <strong>${data.id}</strong></span>
      <span class="result-meta-item">Idioma: <strong>${(data.language || "es").toUpperCase()}</strong></span>
      <span class="result-meta-item">Duración audio: <strong>${data.duration_seconds}s (${durMin} min)</strong></span>
      <span class="result-meta-item">Procesado en: <strong>${data.processing_time_seconds}s</strong></span>
    `;

    // Plain text view
    plainTextView.textContent = data.text || "(Transcripción vacía o solo silencio)";

    // Timestamp view
    timestampView.innerHTML = "";
    if (data.segments && data.segments.length > 0) {
      data.segments.forEach(seg => {
        const row = document.createElement("div");
        row.className = "segment-item";
        row.innerHTML = `
          <span class="segment-timestamp">[${formatTimeDisplay(seg.start)} &rarr; ${formatTimeDisplay(seg.end)}]</span>
          <span class="segment-text">${escapeHtml(seg.text)}</span>
        `;
        timestampView.appendChild(row);
      });
    } else {
      timestampView.innerHTML = `<p class="empty-state">No se registraron marcas de tiempo.</p>`;
    }

    // Toggle default to plain text
    showTimestampsCheck.checked = false;
    plainTextView.style.display = "block";
    timestampView.style.display = "none";

    // Download buttons
    downloadButtons.innerHTML = "";
    if (data.downloads) {
      if (data.downloads.txt) {
        downloadButtons.innerHTML += `
          <a href="${data.downloads.txt}" class="btn btn-secondary btn-sm" download>
            📄 Descargar .TXT
          </a>
        `;
      }
      if (data.downloads.srt) {
        downloadButtons.innerHTML += `
          <a href="${data.downloads.srt}" class="btn btn-secondary btn-sm" download>
            📝 Descargar .SRT
          </a>
        `;
      }
      if (data.downloads.mp3) {
        downloadButtons.innerHTML += `
          <a href="${data.downloads.mp3}" class="btn btn-secondary btn-sm" download>
            🎵 Descargar .MP3
          </a>
        `;
      }
    }

    // Smooth scroll to result
    resultCard.scrollIntoView({ behavior: "smooth" });
  }

  function formatTimeDisplay(secs) {
    if (secs == null || isNaN(secs)) return "00:00";
    const totalSecs = Math.floor(secs);
    const m = Math.floor(totalSecs / 60);
    const s = totalSecs % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }

  function escapeHtml(str) {
    return (str || "").replace(/[&<>"']/g, function(m) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      }[m];
    });
  }

  // ==========================================
  // Historial de Sesiones
  // ==========================================
  async function fetchHistory() {
    try {
      const res = await fetch("/api/history");
      if (!res.ok) return;
      const historyItems = await res.json();
      historyCount.textContent = historyItems.length;

      if (historyItems.length === 0) {
        historyList.innerHTML = `<p class="empty-state">No hay grabaciones o transcripciones previas.</p>`;
        return;
      }

      historyList.innerHTML = "";
      historyItems.forEach(item => {
        const itemEl = document.createElement("div");
        itemEl.className = "history-item";

        const dateStr = item.created_at ? new Date(item.created_at).toLocaleString() : item.id;
        const durStr = item.duration_seconds ? `${item.duration_seconds}s` : "";

        let downloadLinksHtml = "";
        if (item.downloads) {
          if (item.downloads.txt) {
            downloadLinksHtml += `<a href="${item.downloads.txt}" class="btn btn-ghost btn-sm" download title="Descargar texto">📄 .txt</a>`;
          }
          if (item.downloads.srt) {
            downloadLinksHtml += `<a href="${item.downloads.srt}" class="btn btn-ghost btn-sm" download title="Descargar subtítulos">📝 .srt</a>`;
          }
          if (item.downloads.mp3) {
            downloadLinksHtml += `<a href="${item.downloads.mp3}" class="btn btn-ghost btn-sm" download title="Descargar audio">🎵 .mp3</a>`;
          }
        }

        itemEl.innerHTML = `
          <div class="history-item-top">
            <span class="history-item-date">${dateStr}</span>
            <div class="history-item-badges">
              <span class="badge badge-model">${item.model || "turbo"}</span>
              <span class="badge">${(item.language || "es").toUpperCase()}</span>
              ${durStr ? `<span class="badge">${durStr}</span>` : ""}
            </div>
          </div>
          <div class="history-item-preview">${escapeHtml(item.preview || item.text || "(Sin texto)")}</div>
          <div class="history-item-actions">
            ${downloadLinksHtml}
            <button class="btn btn-secondary btn-sm view-history-btn">Ver en visor</button>
          </div>
        `;

        itemEl.querySelector(".view-history-btn").addEventListener("click", () => {
          displayResult(item);
        });

        historyList.appendChild(itemEl);
      });
    } catch (err) {
      console.warn("Error cargando historial:", err);
    }
  }

  refreshHistoryBtn.addEventListener("click", fetchHistory);
});
