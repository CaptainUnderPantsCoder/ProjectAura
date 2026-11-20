/*
 * Aura — frontend pédagogique pour ProjectAura-Backend.
 * Compatible avec l'API FastAPI publique : POST /predict {pixels: number[28][28]}
 * La normalisation Python est effectuée PAR LE SCALER du backend :
 * ne jamais diviser les valeurs 0..255 par 255 dans ce frontend.
 * Aucune prédiction n'est simulée. L'API doit être en ligne pour obtenir un résultat.
 */
(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const canvas = $('#drawingCanvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const preview = $('#pixelCanvas');
  const pctx = preview.getContext('2d');
  const workingCanvas = document.createElement('canvas');
  workingCanvas.width = 28;
  workingCanvas.height = 28;
  const wctx = workingCanvas.getContext('2d', { willReadFrequently: true });
  const DEFAULT_API_BASE = 'http://127.0.0.1:8000';

  let apiBase = DEFAULT_API_BASE;
  let strokes = [];
  let activeStroke = null;
  let activePointer = null;
  let previewTimer = null;
  let lastPixels = emptyPixels();
  let history = [];
  let pendingPrediction = false;
  let toastTimer = null;
  let runSequence = 0;

  const elements = {
    hint: $('#canvasHint'),
    clear: $('#clearButton'),
    undo: $('#undoButton'),
    predict: $('#predictButton'),
    predictText: $('#predictButtonText'),
    predictIcon: $('#predictIcon'),
    predictSpinner: $('#predictSpinner'),
    brush: $('#brushSize'),
    brushSizeLabel: $('#brushSizeLabel'),
    brushPreview: $('#brushPreview'),
    predictionEmpty: $('#predictionEmpty'),
    predictionContent: $('#predictionContent'),
    predictedDigit: $('#predictedDigit'),
    confidenceCircle: $('#confidenceCircle'),
    confidenceValue: $('#confidenceValue'),
    confidenceFill: $('#confidenceFill'),
    resultStatus: $('#resultStatus'),
    resultStatusText: $('#resultStatusText'),
    resultExplainer: $('#resultExplainer'),
    predictionMessage: $('#predictionMessage'),
    connectionBadge: $('#connectionBadge'),
    connectionText: $('#connectionText'),
    historyCount: $('#historyCount'),
    historyEmpty: $('#historyEmpty'),
    historyList: $('#historyList'),
    pixelValue: $('#pixelValue'),
    pixelBinary: $('#pixelBinary'),
    toast: $('#toast'),
    settingsDialog: $('#settingsDialog'),
    settingsButton: $('#settingsButton'),
    settingsForm: $('#settingsForm'),
    apiBaseInput: $('#apiBaseInput'),
    settingsStatus: $('#settingsStatus'),
    menuButton: $('#menuButton'),
    navLinks: $('#navLinks'),
  };

  // ─── Drawing ─────────────────────────────────────────────
  function fillCanvasBlack() {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function drawStroke(stroke) {
    const points = stroke.points;
    if (!points.length) return;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = stroke.width;
    ctx.strokeStyle = '#ffffff';
    ctx.fillStyle = '#ffffff';
    if (points.length === 1) {
      ctx.beginPath();
      ctx.arc(points[0].x, points[0].y, stroke.width / 2, 0, 2 * Math.PI);
      ctx.fill();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();
  }

  function renderDrawing() {
    fillCanvasBlack();
    strokes.forEach(drawStroke);
    if (activeStroke) drawStroke(activeStroke);
    elements.hint.hidden = strokes.length > 0 || Boolean(activeStroke);
    elements.undo.disabled = strokes.length === 0;
  }

  function eventPosition(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(canvas.width, (event.clientX - rect.left) * canvas.width / rect.width)),
      y: Math.max(0, Math.min(canvas.height, (event.clientY - rect.top) * canvas.height / rect.height)),
    };
  }

  function onPointerDown(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    if (activeStroke) return;
    runSequence++; // Any in-flight response will not overwrite a newer drawing.
    hidePrediction();
    activePointer = event.pointerId;
    activeStroke = { points: [eventPosition(event)], width: Number(elements.brush.value) };
    canvas.setPointerCapture(event.pointerId);
    renderDrawing();
    schedulePreview();
  }

  function onPointerMove(event) {
    if (!activeStroke || event.pointerId !== activePointer) return;
    event.preventDefault();
    const point = eventPosition(event);
    const last = activeStroke.points[activeStroke.points.length - 1];
    if (Math.hypot(point.x - last.x, point.y - last.y) < 1.25) return;
    activeStroke.points.push(point);
    renderDrawing();
    schedulePreview();
  }

  function onPointerUp(event) {
    if (!activeStroke || event.pointerId !== activePointer) return;
    event.preventDefault();
    const stroke = activeStroke;
    activeStroke = null;
    activePointer = null;
    strokes.push(stroke);
    renderDrawing();
    schedulePreview(true);
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('lostpointercapture', onPointerUp);

  function hidePrediction() {
    elements.predictionEmpty.hidden = false;
    elements.predictionContent.hidden = true;
    elements.predictionMessage.textContent = '';
  }

  function clearDrawing() {
    runSequence++;
    strokes = [];
    activeStroke = null;
    activePointer = null;
    renderDrawing();
    hidePrediction();
    schedulePreview(true);
  }

  function undoStroke() {
    if (!strokes.length) return;
    runSequence++;
    strokes.pop();
    renderDrawing();
    hidePrediction();
    schedulePreview(true);
  }

  elements.clear.addEventListener('click', clearDrawing);
  elements.undo.addEventListener('click', undoStroke);
  elements.brush.addEventListener('input', () => {
    const value = Number(elements.brush.value);
    elements.brushPreview.style.width = `${Math.round(value / 2.5)}px`;
    elements.brushPreview.style.height = `${Math.round(value / 2.5)}px`;
    elements.brushSizeLabel.textContent = value < 40 ? 'Fin' : value < 60 ? 'Moyen' : 'Épais';
  });
  elements.brush.dispatchEvent(new Event('input'));

  // Predefined drawing strokes. These are SAMPLES, not fabricated model predictions.
  const examples = {
    '2': [[.25,.28],[.31,.18],[.47,.15],[.63,.18],[.76,.29],[.77,.42],[.71,.52],[.56,.65],[.36,.79],[.25,.86],[.77,.86]],
    '4': [[.68,.17],[.26,.62],[.80,.62],null,[.68,.17],[.68,.87]],
    '7': [[.25,.22],[.79,.22],[.48,.59],[.37,.85]],
  };
  function loadExample(digit) {
    const path = examples[digit];
    if (!path) return;
    runSequence++;
    strokes = [];
    let current = [];
    const pushCurrent = () => {
      if (current.length) strokes.push({ points: current, width: Number(elements.brush.value) });
      current = [];
    };
    for (const point of path) {
      if (point === null) pushCurrent();
      else current.push({ x: point[0] * canvas.width, y: point[1] * canvas.height });
    }
    pushCurrent();
    renderDrawing();
    hidePrediction();
    schedulePreview(true);
    toast(`Exemple ${digit} chargé. Cliquez sur « Reconnaître » pour interroger le modèle.`);
  }
  document.querySelectorAll('[data-example]').forEach((button) => {
    button.addEventListener('click', () => loadExample(button.dataset.example));
  });

  document.addEventListener('keydown', (event) => {
    if (elements.settingsDialog.open) return;
    const tag = document.activeElement?.tagName;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      undoStroke();
    }
  });

  // ─── Pixel conversion: match the source repository algorithm ─────
  function emptyPixels() { return Array.from({ length: 28 }, () => Array(28).fill(0)); }

  function makeMnistPixels() {
    const source = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let minX = canvas.width, minY = canvas.height, maxX = -1, maxY = -1;
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const brightness = source.data[(y * canvas.width + x) * 4];
        if (brightness > 20) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null;
    const boxWidth = maxX - minX + 1;
    const boxHeight = maxY - minY + 1;
    const scale = 20 / Math.max(boxWidth, boxHeight);
    const resizedWidth = Math.max(1, Math.round(boxWidth * scale));
    const resizedHeight = Math.max(1, Math.round(boxHeight * scale));
    wctx.fillStyle = '#000000';
    wctx.fillRect(0, 0, 28, 28);
    wctx.imageSmoothingEnabled = true;
    wctx.imageSmoothingQuality = 'high';
    const offsetX = Math.round((28 - resizedWidth) / 2);
    const offsetY = Math.round((28 - resizedHeight) / 2);
    wctx.drawImage(canvas, minX, minY, boxWidth, boxHeight, offsetX, offsetY, resizedWidth, resizedHeight);
    const data = wctx.getImageData(0, 0, 28, 28).data;
    const pixels = [];
    for (let y = 0; y < 28; y++) {
      const row = [];
      for (let x = 0; x < 28; x++) row.push(data[(y * 28 + x) * 4]);
      pixels.push(row);
    }
    return pixels;
  }

  function schedulePreview(immediately = false) {
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(updatePixelPreview, immediately ? 0 : 110);
  }

  function updatePixelPreview() {
    previewTimer = null;
    lastPixels = makeMnistPixels() || emptyPixels();
    const imageData = pctx.createImageData(28, 28);
    for (let y = 0; y < 28; y++) {
      for (let x = 0; x < 28; x++) {
        const idx = (y * 28 + x) * 4;
        const n = lastPixels[y][x];
        imageData.data[idx] = n;
        imageData.data[idx + 1] = n;
        imageData.data[idx + 2] = n;
        imageData.data[idx + 3] = 255;
      }
    }
    const pixelsCanvas = document.createElement('canvas');
    pixelsCanvas.width = 28;
    pixelsCanvas.height = 28;
    pixelsCanvas.getContext('2d').putImageData(imageData, 0, 0);
    pctx.imageSmoothingEnabled = false;
    pctx.clearRect(0, 0, preview.width, preview.height);
    pctx.drawImage(pixelsCanvas, 0, 0, 280, 280);
    pctx.strokeStyle = 'rgba(222,236,235,.16)';
    pctx.lineWidth = .5;
    pctx.beginPath();
    for (let n = 0; n <= 28; n++) {
      pctx.moveTo(n * 10 + .25, 0); pctx.lineTo(n * 10 + .25, 280);
      pctx.moveTo(0, n * 10 + .25); pctx.lineTo(280, n * 10 + .25);
    }
    pctx.stroke();
    readPixel(14, 14);
  }

  function readPixel(x, y) {
    const value = lastPixels[y]?.[x] ?? 0;
    elements.pixelValue.textContent = String(value);
    elements.pixelBinary.textContent = value.toString(2).padStart(8, '0');
  }

  function inspectPixel(event) {
    const rect = preview.getBoundingClientRect();
    const x = Math.min(27, Math.max(0, Math.floor((event.clientX - rect.left) / rect.width * 28)));
    const y = Math.min(27, Math.max(0, Math.floor((event.clientY - rect.top) / rect.height * 28)));
    readPixel(x, y);
  }
  preview.addEventListener('pointermove', inspectPixel);
  preview.addEventListener('pointerdown', inspectPixel);

  // ─── FastAPI integration ───────────────────────────────────
  function setConnection(status) {
    elements.connectionBadge.classList.remove('online', 'offline', 'checking');
    elements.connectionBadge.classList.add(status);
    const labels = {
      online: 'API connectée',
      offline: 'API hors ligne',
      checking: 'Vérification de l’API…'
    };
    elements.connectionText.textContent = labels[status];
    elements.connectionBadge.title = `Serveur : ${apiBase}. Cliquer pour retester.`;
  }

  async function checkConnection() {
    setConnection('checking');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    try {
      const response = await fetch(apiBase + '/', { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) throw new Error('Le serveur ne répond pas correctement.');
      const body = await response.json();
      if (body.status !== 'ok') throw new Error('Réponse API inconnue.');
      setConnection('online');
      return true;
    } catch {
      setConnection('offline');
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  function setLoading(isLoading) {
    pendingPrediction = isLoading;
    elements.predict.disabled = isLoading;
    elements.predictText.textContent = isLoading ? 'Analyse en cours…' : 'Reconnaître';
    elements.predictIcon.hidden = isLoading;
    elements.predictSpinner.hidden = !isLoading;
  }

  async function predict() {
    if (pendingPrediction) return;
    // Always rasterize NOW, not from a stale cached preview.
    const pixels = makeMnistPixels();
    if (!pixels) {
      toast('Dessinez d’abord un chiffre (0 à 9).');
      return;
    }
    lastPixels = pixels;
    schedulePreview(true);
    const thisRun = ++runSequence;
    const snapshot = canvas.toDataURL('image/png');
    setLoading(true);
    elements.predictionMessage.textContent = '';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(apiBase + '/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pixels }),
        signal: controller.signal,
      });
      let data;
      try { data = await response.json(); }
      catch { throw new Error('Le serveur a renvoyé une réponse illisible.'); }
      if (!response.ok) {
        let detail = typeof data.detail === 'string' ? data.detail : 'Une erreur est survenue dans le backend.';
        throw new Error(detail);
      }
      if (thisRun !== runSequence) return; // User edited the input while the request was running.
      setConnection('online');
      showPrediction(data);
      recordHistory(data, snapshot);
    } catch (error) {
      if (thisRun !== runSequence) return;
      if (error?.name === 'AbortError') {
        elements.predictionMessage.textContent = 'Le serveur a mis trop de temps à répondre. Vérifiez FastAPI.';
      } else if (error instanceof TypeError) {
        elements.predictionMessage.textContent = 'Impossible de joindre le modèle. Démarrez run_backend.bat puis réessayez.';
        setConnection('offline');
      } else {
        elements.predictionMessage.textContent = `Erreur : ${error.message || 'réponse inconnue'}`;
      }
      toast(elements.predictionMessage.textContent);
    } finally {
      clearTimeout(timer);
      if (thisRun === runSequence || pendingPrediction) setLoading(false);
    }
  }

  function showPrediction(data) {
    const score = Number(data.confidence);
    const confidence = Number.isFinite(score) ? Math.min(100, Math.max(0, score * 100)) : 0;
    const digit = data.digit;
    const uncertain = digit === null || digit === undefined;
    elements.predictionEmpty.hidden = true;
    elements.predictionContent.hidden = false;
    elements.predictedDigit.textContent = uncertain ? '?' : String(digit);
    elements.predictedDigit.classList.toggle('uncertain', uncertain);
    elements.confidenceValue.textContent = `${confidence.toFixed(1).replace('.', ',')}%`;
    elements.confidenceCircle.style.background = `conic-gradient(#eba185 ${confidence}%,#38494c ${confidence}%)`;
    elements.confidenceFill.style.width = `${confidence}%`;
    elements.resultStatus.classList.toggle('uncertain', uncertain);
    elements.resultStatusText.textContent = uncertain ? 'Prédiction incertaine' : 'Chiffre reconnu par le modèle';
    elements.resultExplainer.textContent = uncertain
      ? (typeof data.message === 'string' ? data.message : 'Le modèle ne reconnaît pas suffisamment ce dessin. Essayez un tracé plus clair.')
      : `Le modèle prédit le chiffre ${digit}. Son score pour cette réponse est de ${confidence.toFixed(1).replace('.', ',')} %. Cela ne garantit pas que la réponse est correcte.`;
  }

  function recordHistory(data, snapshot) {
    const score = Number(data.confidence);
    history.unshift({
      digit: data.digit === null || data.digit === undefined ? '?' : String(data.digit),
      confidence: Number.isFinite(score) ? Math.max(0, Math.min(100, score * 100)) : 0,
      image: snapshot,
    });
    history = history.slice(0, 5);
    elements.historyEmpty.hidden = history.length > 0;
    elements.historyList.replaceChildren();
    elements.historyCount.textContent = `${history.length} essai${history.length === 1 ? '' : 's'}`;
    history.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'history-row';
      const img = document.createElement('img');
      img.className = 'history-thumb';
      img.alt = 'Dessin de l’essai';
      img.src = item.image;
      const meta = document.createElement('div');
      meta.className = 'history-meta';
      const title = document.createElement('strong');
      title.textContent = item.digit === '?' ? 'Prédiction incertaine' : `Chiffre ${item.digit}`;
      const subtitle = document.createElement('small');
      subtitle.textContent = `Score : ${item.confidence.toFixed(1).replace('.', ',')} %`;
      const value = document.createElement('div');
      value.className = 'history-value';
      value.textContent = item.digit;
      meta.append(title, subtitle);
      row.append(img, meta, value);
      elements.historyList.append(row);
    });
  }

  elements.predict.addEventListener('click', predict);
  elements.connectionBadge.addEventListener('click', () => {
    checkConnection().then(ok => toast(ok ? 'Backend connecté, vous pouvez lancer la prédiction.' : 'API inaccessible. Démarrez run_backend.bat.'));
  });

  // ─── API settings ──────────────────────────────────────────
  elements.settingsButton.addEventListener('click', () => {
    elements.apiBaseInput.value = apiBase;
    elements.settingsStatus.textContent = '';
    elements.settingsDialog.showModal();
  });
  $('#closeSettings').addEventListener('click', () => elements.settingsDialog.close());
  elements.settingsDialog.addEventListener('click', event => {
    if (event.target === elements.settingsDialog) elements.settingsDialog.close();
  });
  $('#resetApiButton').addEventListener('click', () => {
    elements.apiBaseInput.value = DEFAULT_API_BASE;
  });
  elements.settingsForm.addEventListener('submit', (event) => {
    event.preventDefault();
    let value = elements.apiBaseInput.value.trim().replace(/\/+$/, '').replace(/\/predict$/i, '');
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('invalid protocol');
      if (url.username || url.password || url.search || url.hash) throw new Error('unexpected url');
      value = url.href.replace(/\/+$/, '');
    } catch {
      elements.settingsStatus.textContent = 'Entrez une URL HTTP(S) valide, par exemple http://127.0.0.1:8000';
      return;
    }
    apiBase = value;
    elements.settingsDialog.close();
    checkConnection().then(ok => toast(ok ? `Connecté à ${apiBase}` : `Serveur non accessible : ${apiBase}`));
  });

  // ─── Navigation and presentation polish ────────────────────
  function toast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => elements.toast.classList.remove('visible'), 4300);
  }

  elements.menuButton.addEventListener('click', () => {
    const isOpen = elements.navLinks.classList.toggle('open');
    elements.menuButton.setAttribute('aria-expanded', String(isOpen));
    elements.menuButton.setAttribute('aria-label', isOpen ? 'Fermer le menu' : 'Ouvrir le menu');
  });
  elements.navLinks.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
    elements.navLinks.classList.remove('open');
    elements.menuButton.setAttribute('aria-expanded', 'false');
  }));

  const revealItems = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: .07, rootMargin: '0px 0px -30px 0px' });
    revealItems.forEach(node => observer.observe(node));
  } else revealItems.forEach(node => node.classList.add('is-visible'));

  // Initialise without inventing a prediction when the server is unavailable.
  fillCanvasBlack();
  hidePrediction();
  updatePixelPreview();
  checkConnection();
})();
