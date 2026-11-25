// Scanner de codes-barres plein écran.
// Utilise BarcodeDetector quand le navigateur le propose (Chrome Android),
// sinon la bibliothèque ZXing embarquée (iPhone, Firefox…), chargée à la demande.

import { $, esc, beep, vibrate, pushBackHandler, popBackHandler, swallowNextPop } from "./ui.js";

const ZXING_SRC = "./js/vendor/zxing.min.js";
const NATIVE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf"];

// Un même produit doit donner le même code, quel que soit le téléphone :
// un UPC-A (12 chiffres) est ramené à son équivalent EAN-13.
export function normalizeCode(raw) {
  const c = String(raw || "").trim().replace(/\s+/g, "");
  if (/^\d{12}$/.test(c)) return `0${c}`;
  return c;
}

let zxingPromise = null;
function loadZXing() {
  if (window.ZXing) return Promise.resolve(window.ZXing);
  if (!zxingPromise) {
    zxingPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = ZXING_SRC;
      s.onload = () => (window.ZXing ? resolve(window.ZXing) : reject(new Error("zxing")));
      s.onerror = () => { zxingPromise = null; reject(new Error("zxing")); };
      document.head.appendChild(s);
    });
  }
  return zxingPromise;
}

async function createDecoder() {
  if ("BarcodeDetector" in window) {
    try {
      const supported = await window.BarcodeDetector.getSupportedFormats();
      const formats = NATIVE_FORMATS.filter(f => supported.includes(f));
      if (formats.includes("ean_13")) {
        const detector = new window.BarcodeDetector({ formats });
        return async video => {
          const codes = await detector.detect(video);
          return codes[0]?.rawValue || null;
        };
      }
    } catch { /* on passe à ZXing */ }
  }
  const Z = await loadZXing();
  const hints = new Map();
  hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [
    Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E,
    Z.BarcodeFormat.CODE_128, Z.BarcodeFormat.CODE_39, Z.BarcodeFormat.ITF
  ]);
  hints.set(Z.DecodeHintType.TRY_HARDER, true);
  const reader = new Z.MultiFormatReader();
  reader.setHints(hints);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  return async video => {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;
    // On ne lit que la bande centrale (là où se trouve le cadre) : plus rapide et plus fiable.
    const cw = Math.round(vw * 0.86);
    const ch = Math.round(vh * 0.42);
    const scale = Math.min(1, 900 / cw);
    canvas.width = Math.round(cw * scale);
    canvas.height = Math.round(ch * scale);
    ctx.drawImage(video, (vw - cw) / 2, (vh - ch) / 2, cw, ch, 0, 0, canvas.width, canvas.height);
    try {
      const source = new Z.HTMLCanvasElementLuminanceSource(canvas);
      const bitmap = new Z.BinaryBitmap(new Z.HybridBinarizer(source));
      return reader.decode(bitmap).getText();
    } catch {
      return null;
    } finally {
      reader.reset();
    }
  };
}

/**
 * Ouvre le scanner.
 * options : { title, hint, modes: [{ id, label }], mode, onModeChange(id), onCode(code, ctrl) }
 * Après chaque lecture, le scanner se met en pause : l'appelant appelle ctrl.resume() pour continuer.
 */
export function openScanner({ title = "Scanner", hint = "Place le code-barres dans le cadre", modes = null, mode = null, onModeChange, onCode }) {
  const root = $("#scanner-root");
  const el = document.createElement("section");
  el.className = "scanner";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-label", title);
  el.innerHTML = `
    <video playsinline muted autoplay></video>
    <div class="scanner-top">
      <h2>${esc(title)}</h2>
      <button type="button" class="icon-btn hidden" data-torch aria-label="Lampe" aria-pressed="false"><i class="fa-solid fa-bolt"></i></button>
      <button type="button" class="icon-btn" data-close aria-label="Fermer le scanner"><i class="fa-solid fa-xmark"></i></button>
    </div>
    ${modes ? `<div class="scanner-modes"><div class="seg" role="group" aria-label="Que faire à chaque scan ?">
      ${modes.map(m => `<button type="button" data-mode="${m.id}" aria-pressed="${m.id === mode}">${esc(m.label)}</button>`).join("")}
    </div></div>` : ""}
    <div class="scanner-frame"><div></div></div>
    <p class="scanner-hint" data-hint>${esc(hint)}</p>
    <div class="scanner-panel">
      <div data-panel></div>
      <form class="scanner-manual" data-manual>
        <input type="text" inputmode="numeric" autocomplete="off" placeholder="Ou saisir le code-barres" aria-label="Code-barres" maxlength="32">
        <button type="submit" class="btn btn-ghost btn-small">OK</button>
      </form>
    </div>`;
  root.appendChild(el);
  document.body.classList.add("no-scroll", "scanner-open");

  const video = $("video", el);
  const panel = $("[data-panel]", el);
  let stream = null;
  let track = null;
  let decode = null;
  let paused = false;
  let closed = false;
  let timer = null;
  let last = { code: "", at: 0 };

  const ctrl = {
    el,
    panel,
    get paused() { return paused; },
    pause() { paused = true; el.classList.add("is-paused"); },
    resume() {
      paused = false;
      el.classList.remove("is-paused");
      if (!closed) schedule(250);
    },
    setPanel(html) { panel.innerHTML = html; return panel; },
    setHint(text) { $("[data-hint]", el).textContent = text; },
    close() { if (!closed) history.back(); },
    // Laisse passer un nouveau scan du même code tout de suite (ex. « + 1 » en rafale).
    forgetLast() { last = { code: "", at: 0 }; }
  };

  async function handle(raw) {
    const code = normalizeCode(raw);
    if (!code) return;
    const now = Date.now();
    if (code === last.code && now - last.at < 2500) { if (!paused) schedule(); return; }
    last = { code, at: now };
    beep();
    vibrate(35);
    ctrl.pause();
    try {
      await onCode(code, ctrl);
    } catch (err) {
      console.error(err);
      ctrl.resume();
    }
  }

  function schedule(ms = 140) {
    clearTimeout(timer);
    timer = setTimeout(tick, ms);
  }

  async function tick() {
    if (closed || paused || !decode) return;
    if (video.readyState >= 2) {
      try {
        const code = await decode(video);
        if (code && !paused && !closed) { handle(code); return; }
      } catch { /* image illisible */ }
    }
    schedule();
  }

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      showError("Ce navigateur ne donne pas accès à la caméra. Saisis le code à la main ci-dessous.");
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }
      });
    } catch (err) {
      console.error(err);
      const denied = err?.name === "NotAllowedError" || err?.name === "SecurityError";
      showError(denied
        ? "L’accès à la caméra est refusé. Autorise-le dans les réglages du navigateur, ou saisis le code ci-dessous."
        : "Impossible d’ouvrir la caméra. Saisis le code-barres ci-dessous.");
      return;
    }
    if (closed) { stream.getTracks().forEach(t => t.stop()); return; }
    video.srcObject = stream;
    track = stream.getVideoTracks()[0];
    try { await video.play(); } catch { /* lecture auto bloquée : l'image arrivera au premier toucher */ }
    try {
      const caps = track.getCapabilities?.();
      if (caps?.torch) $("[data-torch]", el).classList.remove("hidden");
    } catch { /* rien */ }
    try {
      decode = await createDecoder();
    } catch {
      showError("Le lecteur de codes-barres n’a pas pu se charger. Saisis le code ci-dessous.");
      return;
    }
    schedule(300);
  }

  function showError(msg) {
    ctrl.setHint("");
    if (!panel.innerHTML.trim()) panel.innerHTML = `<p class="scanner-error">${esc(msg)}</p>`;
    setTimeout(() => $("[data-manual] input", el)?.focus(), 100);
  }

  function teardown() {
    closed = true;
    clearTimeout(timer);
    stream?.getTracks().forEach(t => t.stop());
    el.remove();
    document.body.classList.remove("scanner-open");
    if (!document.querySelector(".sheet-backdrop")) document.body.classList.remove("no-scroll");
  }

  pushBackHandler(teardown);
  ctrl.closeNow = () => {
    // Fermeture immédiate (sans attendre l'historique), puis retrait de l'entrée d'historique.
    if (closed) return Promise.resolve();
    popBackHandler(teardown);
    teardown();
    swallowNextPop();
    return new Promise(resolve => {
      const done = () => { window.removeEventListener("popstate", done); resolve(); };
      window.addEventListener("popstate", done);
      history.back();
      setTimeout(done, 400);
    });
  };

  $("[data-close]", el).addEventListener("click", () => ctrl.close());
  $("[data-torch]", el).addEventListener("click", async e => {
    const btn = e.currentTarget;
    const on = btn.getAttribute("aria-pressed") !== "true";
    try {
      await track.applyConstraints({ advanced: [{ torch: on }] });
      btn.setAttribute("aria-pressed", String(on));
    } catch { /* lampe indisponible */ }
  });
  el.querySelectorAll("[data-mode]").forEach(b => b.addEventListener("click", () => {
    el.querySelectorAll("[data-mode]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    onModeChange?.(b.dataset.mode);
  }));
  $("[data-manual]", el).addEventListener("submit", e => {
    e.preventDefault();
    const input = $("input", e.currentTarget);
    const v = input.value.trim();
    if (!v) return;
    input.value = "";
    input.blur();
    last = { code: "", at: 0 };
    handle(v);
  });
  video.addEventListener("click", () => video.play().catch(() => {}));

  start();
  return ctrl;
}
