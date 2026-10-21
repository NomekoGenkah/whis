/**
 * Whis — Grabador Web y Transcriptor Local
 * Frontend Vanilla JS con Web Audio API, MediaRecorder, Fetch API y Tema Claro/Oscuro.
 */

document.addEventListener("DOMContentLoaded", () => {
  // --- Theme Management ---
  const htmlRoot = document.documentElement;
  const themeToggleBtn = document.getElementById("themeToggleBtn");
  const themeIconSlot = document.getElementById("themeIconSlot");
  const themeLabel = document.getElementById("themeLabel");

  const sunIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;
  const moonIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;

  function initTheme() {
    const savedTheme = localStorage.getItem("whis-theme") || "dark";
    setTheme(savedTheme);
  }

  function setTheme(theme) {
    htmlRoot.setAttribute("data-theme", theme);
    localStorage.setItem("whis-theme", theme);
    if (theme === "dark") {
      themeIconSlot.innerHTML = sunIcon;
      themeLabel.textContent = "CLARO";
    } else {
      themeIconSlot.innerHTML = moonIcon;
      themeLabel.textContent = "OSCURO";
    }
  }

  themeToggleBtn.addEventListener("click", () => {
    const currentTheme = htmlRoot.getAttribute("data-theme") || "dark";
    setTheme(currentTheme === "dark" ? "light" : "dark");
  });

  initTheme();

  // --- DOM Elements ---
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
  const recordNotice = document.getElementById("recordNotice");
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
  const copyBtnText = document.getElementById("copyBtnText");
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

  // --- Initialize Components ---
  checkMediaPermissionsSupport();
  setupTabs();
  setupRecordingControls();
  setupUploadZone();
  setupResultView();
  fetchHistory();

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

  // --- Browser & Environment Detection ---
  const isFirefox = /firefox/i.test(navigator.userAgent);

  function getOptimalMimeType() {
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/ogg;codecs=opus",
      "audio/webm",
      "audio/ogg",
    ];
    for (const mime of candidates) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(mime)) {
        return mime;
      }
    }
    return "";
  }

  // ==========================================
  // RF-01: Grabación Web con Web Audio API
  // ==========================================
  async function enumerateMicrophones() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      micSelect.innerHTML = `<option value="">Dispositivo predeterminado</option>`;
      return;
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(d => d.kind === "audioinput");

      micSelect.innerHTML = "";
      if (audioInputs.length === 0) {
        micSelect.innerHTML = `<option value="">Dispositivo predeterminado (o sin permiso)</option>`;
        return;
      }

      audioInputs.forEach((device, idx) => {
        const option = document.createElement("option");
        option.value = device.deviceId;
        let label = device.label || `Dispositivo ${idx + 1}`;
        if (/monitor|stereo mix|mezcla|loopback/i.test(label)) {
          label += " [AUDIO SISTEMA / MONITOR]";
        }
        option.textContent = label;
        micSelect.appendChild(option);
      });
    } catch (err) {
      console.warn("Error enumerating devices:", err);
      micSelect.innerHTML = `<option value="">Dispositivo predeterminado</option>`;
    }
  }

  refreshDevicesBtn.addEventListener("click", async () => {
    refreshDevicesBtn.disabled = true;
    refreshDevicesBtn.innerHTML = `<span>BUSCANDO...</span>`;
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
          const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          tempStream.getTracks().forEach(t => t.stop());
        } catch (_) {}
      }
      await enumerateMicrophones();
    } finally {
      refreshDevicesBtn.disabled = false;
      refreshDevicesBtn.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square">
          <polyline points="23 4 23 10 17 10"/>
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
        </svg>
        <span>ACTUALIZAR</span>
      `;
    }
  });

  enumerateMicrophones();

  function setupRecordingControls() {
    startRecordBtn.addEventListener("click", startRecording);
    pauseRecordBtn.addEventListener("click", pauseRecording);
    resumeRecordBtn.addEventListener("click", resumeRecording);
    stopRecordBtn.addEventListener("click", stopRecording);

    downloadRawRecordBtn.addEventListener("click", () => {
      if (!recordedBlob) return;
      const ext = recordedBlob.type && recordedBlob.type.includes("ogg") ? ".ogg" : ".webm";
      const url = URL.createObjectURL(recordedBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `recording_${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "")}${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    });

    transcribeRecordedBtn.addEventListener("click", () => {
      if (!recordedBlob) return;
      const ext = recordedBlob.type && recordedBlob.type.includes("ogg") ? ".ogg" : ".webm";
      const filename = `recording_${Date.now()}${ext}`;
      const file = new File([recordedBlob], filename, { type: recordedBlob.type || "audio/webm" });
      sendToTranscribe(file);
    });

    discardRecordBtn.addEventListener("click", () => {
      if (confirm("¿Descartar esta grabación?")) {
        resetRecordingState();
      }
    });
  }

  function showRecordNotice(msg) {
    if (recordNotice) {
      recordNotice.textContent = msg;
      recordNotice.style.display = "block";
    }
  }

  function hideRecordNotice() {
    if (recordNotice) {
      recordNotice.style.display = "none";
      recordNotice.textContent = "";
    }
  }

  async function startRecording() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showRecordNotice("El navegador no soporta captura de audio en este origen HTTP.");
        return;
      }

      hideRecordNotice();
      postRecordPanel.style.display = "none";
      recordedBlob = null;
      recordedChunks = [];

      // 1. AudioContext (handles suspended state in Firefox/Chrome)
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      audioContext = new AudioCtxClass();
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      // 2. Nodes: Master Mixer Gain (1 in, 1 out) and Destination (1 in, 0 out)
      const mixerNode = audioContext.createGain();
      const destinationNode = audioContext.createMediaStreamDestination();
      mixerNode.connect(destinationNode);

      // 3. AnalyserNode for VU meter (connected from mixerNode)
      analyserNode = audioContext.createAnalyser();
      analyserNode.fftSize = 256;
      mixerNode.connect(analyserNode);

      // 4. Microphone stream
      const selectedMicId = micSelect.value;
      const micConstraints = {
        audio: selectedMicId ? { deviceId: { exact: selectedMicId } } : true,
      };

      micStream = await navigator.mediaDevices.getUserMedia(micConstraints);
      enumerateMicrophones();

      const micSource = audioContext.createMediaStreamSource(micStream);
      micSource.connect(mixerNode);

      // 5. System Audio (if selected)
      if (includeSystemAudio.checked) {
        if (!navigator.mediaDevices.getDisplayMedia) {
          showRecordNotice("Captura de pantalla no soportada en este entorno.");
        } else {
          try {
            // Firefox only accepts simple boolean constraints: { video: true, audio: true }
            const displayConstraints = {
              video: true,
              audio: true,
            };

            systemStream = await navigator.mediaDevices.getDisplayMedia(displayConstraints);

            // In Chrome/Firefox, disable video rendering without killing stream
            systemStream.getVideoTracks().forEach(track => {
              track.enabled = false;
            });

            const systemAudioTracks = systemStream.getAudioTracks();
            if (systemAudioTracks.length > 0) {
              const systemSource = audioContext.createMediaStreamSource(
                new MediaStream([systemAudioTracks[0]])
              );
              systemSource.connect(mixerNode);

              systemAudioTracks[0].addEventListener("ended", () => {
                console.info("Pista de audio del sistema finalizada.");
              });
            } else {
              if (isFirefox) {
                showRecordNotice(
                  "Nota Firefox: Firefox no incluye audio vía compartir pantalla (Mozilla Bug #1541425). Para capturar el audio del sistema en Firefox, selecciona la fuente de monitoreo (ej. 'Monitor / Stereo Mix') en el selector de 'Dispositivo de Entrada'. Continuando con la grabación."
                );
              } else {
                showRecordNotice(
                  "Aviso: No se detectó pista de audio del sistema en la selección. Continuando con micrófono."
                );
              }
            }
          } catch (displayErr) {
            console.warn("Captura de pantalla omitida o cancelada:", displayErr);
            showRecordNotice("Captura de pantalla omitida o cancelada. Grabando sólo micrófono.");
          }
        }
      }

      startVuMeter();

      combinedStream = destinationNode.stream;

      const optimalMime = getOptimalMimeType();
      mediaRecorder = new MediaRecorder(combinedStream, optimalMime ? { mimeType: optimalMime } : undefined);

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          recordedChunks.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        const finalType = mediaRecorder.mimeType || optimalMime || "audio/webm";
        recordedBlob = new Blob(recordedChunks, { type: finalType });
        recordedAudioPreview.src = URL.createObjectURL(recordedBlob);
        postRecordPanel.style.display = "block";
      };

      mediaRecorder.start(1000);

      startRecordBtn.style.display = "none";
      pauseRecordBtn.style.display = "inline-flex";
      resumeRecordBtn.style.display = "none";
      stopRecordBtn.style.display = "inline-flex";
      recordingBadge.className = "recording-state-badge active";
      recordingBadge.textContent = "REC";

      recordSeconds = 0;
      updateTimerDisplay();
      recordTimerInterval = setInterval(() => {
        recordSeconds++;
        updateTimerDisplay();
      }, 1000);

    } catch (err) {
      console.error("Error al iniciar grabación:", err);
      showRecordNotice(`No se pudo iniciar la grabación: ${err.message || err.name}`);
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
      recordingBadge.textContent = "PAUSED";
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
      recordingBadge.textContent = "REC";
    }
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }
    clearInterval(recordTimerInterval);
    stopVuMeter();
    cleanupAudioTracks();

    startRecordBtn.style.display = "inline-flex";
    pauseRecordBtn.style.display = "none";
    resumeRecordBtn.style.display = "none";
    stopRecordBtn.style.display = "none";
    recordingBadge.className = "recording-state-badge";
    recordingBadge.textContent = "DONE";
  }

  function resetRecordingState() {
    stopRecording();
    hideRecordNotice();
    postRecordPanel.style.display = "none";
    recordedBlob = null;
    recordedChunks = [];
    recordedAudioPreview.src = "";
    recordSeconds = 0;
    updateTimerDisplay();
    recordingBadge.textContent = "STANDBY";
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
    resultCard.style.display = "none";
    processingCard.style.display = "flex";
    processingStatusText.textContent = `Extrayendo audio con FFmpeg y transcribiendo (${modelSelect.value})...`;
    
    let procSeconds = 0;
    processingTimer.textContent = "00:00";
    clearInterval(processingTimerInterval);
    processingTimerInterval = setInterval(() => {
      procSeconds++;
      const m = Math.floor(procSeconds / 60).toString().padStart(2, "0");
      const s = (procSeconds % 60).toString().padStart(2, "0");
      processingTimer.textContent = `${m}:${s}`;
    }, 1000);

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
        copyBtnText.textContent = "COPIADO";
        setTimeout(() => {
          copyBtnText.textContent = "COPIAR TODO";
        }, 2000);
      }).catch(err => {
        alert("No se pudo copiar al portapapeles: " + err);
      });
    });
  }

  function displayResult(data) {
    currentResultData = data;
    resultCard.style.display = "block";

    const durMin = (data.duration_seconds / 60).toFixed(1);
    resultMeta.innerHTML = `
      <span class="result-meta-item">ID: <strong>${data.id}</strong></span>
      <span class="result-meta-item">LANG: <strong>${(data.language || "es").toUpperCase()}</strong></span>
      <span class="result-meta-item">DURACION: <strong>${data.duration_seconds}s (${durMin}m)</strong></span>
      <span class="result-meta-item">TIEMPO GPU: <strong>${data.processing_time_seconds}s</strong></span>
    `;

    plainTextView.textContent = data.text || "(Sin texto detectado o solo silencio)";

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
      timestampView.innerHTML = `<p class="empty-state">SIN MARCAS DE TIEMPO REGISTRADAS</p>`;
    }

    showTimestampsCheck.checked = false;
    plainTextView.style.display = "block";
    timestampView.style.display = "none";

    downloadButtons.innerHTML = "";
    if (data.downloads) {
      if (data.downloads.txt) {
        downloadButtons.innerHTML += `
          <a href="${data.downloads.txt}" class="btn btn-secondary btn-sm" download>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square"><path d="M21 15v4H3v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            <span>.TXT</span>
          </a>
        `;
      }
      if (data.downloads.srt) {
        downloadButtons.innerHTML += `
          <a href="${data.downloads.srt}" class="btn btn-secondary btn-sm" download>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square"><path d="M21 15v4H3v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            <span>.SRT</span>
          </a>
        `;
      }
      if (data.downloads.mp3) {
        downloadButtons.innerHTML += `
          <a href="${data.downloads.mp3}" class="btn btn-secondary btn-sm" download>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square"><path d="M21 15v4H3v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            <span>.MP3</span>
          </a>
        `;
      }
    }

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
        historyList.innerHTML = `<p class="empty-state">NO HAY SESIONES REGISTRADAS</p>`;
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
            downloadLinksHtml += `<a href="${item.downloads.txt}" class="btn btn-ghost btn-sm" download title="Descargar texto">.TXT</a>`;
          }
          if (item.downloads.srt) {
            downloadLinksHtml += `<a href="${item.downloads.srt}" class="btn btn-ghost btn-sm" download title="Descargar subtítulos">.SRT</a>`;
          }
          if (item.downloads.mp3) {
            downloadLinksHtml += `<a href="${item.downloads.mp3}" class="btn btn-ghost btn-sm" download title="Descargar audio">.MP3</a>`;
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
            <button class="btn btn-secondary btn-sm view-history-btn">VER</button>
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
