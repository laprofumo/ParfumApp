// public/assets/epos.js
// Epson ePOS-Print (network) printing with:
// - SDK auto-loader (epos-device.js)
// - connection cache (per session)
// - offline queue (localStorage) with auto-flush

const SDK_SRC = "/assets/epos-device.js";
const QUEUE_KEY = "lp_epos_offline_queue_v1";
const LAST_OK_KEY = "lp_epos_last_ok_v1";

export function ensureEpsonSdkLoaded() {
  return !!(window.epson && window.epson.ePOSDevice);
}

let _sdkPromise = null;
function _loadEpsonSdk() {
  if (ensureEpsonSdkLoaded()) return Promise.resolve(true);

  if (_sdkPromise) return _sdkPromise;

  _sdkPromise = new Promise((resolve) => {
    const existing = document.getElementById("eposDeviceJs");
    if (existing) {
      const start = Date.now();
      const tick = () => {
        if (ensureEpsonSdkLoaded()) return resolve(true);
        if (Date.now() - start > 4000) return resolve(false);
        setTimeout(tick, 50);
      };
      return tick();
    }

    const s = document.createElement("script");
    s.id = "eposDeviceJs";
    s.src = SDK_SRC;
    s.async = true;

    s.onload = () => {
      setTimeout(() => resolve(ensureEpsonSdkLoaded()), 0);
    };
    s.onerror = () => resolve(false);

    document.head.appendChild(s);
  });

  return _sdkPromise;
}

// Connection/printer cache (per session)
let _cache = {
  ip: null,
  port: null,
  device: null,
  printer: null
};

// Offline queue in localStorage
function _loadQueue() {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    const q = raw ? JSON.parse(raw) : [];
    return Array.isArray(q) ? q : [];
  } catch {
    return [];
  }
}
function _saveQueue(q) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch {
    /* ignore */
  }
}
function _enqueue(job) {
  const q = _loadQueue();
  q.push({ ...job, _ts: Date.now() });
  _saveQueue(q);
}

async function _flushQueue() {
  const q = _loadQueue();
  if (!q.length) return;

  while (q.length) {
    const next = q[0];
    try {
      await eposPrint({ ...next, _skipFlush: true });
      q.shift();
      _saveQueue(q);
    } catch {
      break;
    }
  }
}

function _connectAndCreatePrinter(printerIp, printerPort) {
  return new Promise((resolve, reject) => {
    const device = new window.epson.ePOSDevice();

    device.connect(printerIp, printerPort, (status) => {
      if (status !== "OK") {
        try {
          device.disconnect?.();
        } catch {
          /* ignore */
        }
        return reject(new Error("Verbindung fehlgeschlagen."));
      }

      device.createDevice(
        "local_printer",
        device.DEVICE_TYPE_PRINTER,
        { crypto: false, buffer: false },
        (printer, ret) => {
          if (ret !== "OK" || !printer) {
            try {
              device.disconnect?.();
            } catch {
              /* ignore */
            }
            return reject(new Error("createDevice fehlgeschlagen."));
          }

          _cache = { ip: printerIp, port: printerPort, device, printer };
          try {
            localStorage.setItem(LAST_OK_KEY, String(Date.now()));
          } catch {
            /* ignore */
          }
          resolve(printer);
        }
      );
    });
  });
}

export async function eposWarmup({ printerIp, printerPort = 8008 } = {}) {
  if (!printerIp) return false;

  const ok = await _loadEpsonSdk();
  if (!ok) return false;

  const sameTarget =
    _cache.printer && _cache.ip === printerIp && _cache.port === printerPort;

  if (sameTarget) return true;

  try {
    await _connectAndCreatePrinter(printerIp, printerPort);
    return true;
  } catch {
    return false;
  }
}

function _addQr(printer, qrUrl) {
  if (!qrUrl) return;
  try {
    printer.addTextAlign(printer.ALIGN_CENTER);
    printer.addSymbol(
      qrUrl,
      printer.SYMBOL_QRCODE_MODEL_2,
      printer.LEVEL_L,
      8,
      8,
      0
    );
    printer.addText("\n");
    printer.addTextAlign(printer.ALIGN_LEFT);
  } catch {
    /* ignore */
  }
}

function _finalize(printer) {
  try {
    printer.addCut(printer.CUT_FEED);
  } catch {
    /* ignore */
  }
  printer.send();
}

export async function eposPrint({
  printerIp,
  printerPort = 8008,
  headerText,
  logoBase64,
  qrUrl,
  footerText,
  lines = [],
  title = "",
  _skipFlush = false
} = {}) {
  const sdkOk = await _loadEpsonSdk();
  if (!sdkOk) {
    _enqueue({
      printerIp,
      printerPort,
      headerText,
      logoBase64,
      qrUrl,
      footerText,
      lines,
      title
    });
    throw new Error(
      "Druck offline gespeichert (Epson SDK konnte nicht geladen werden)."
    );
  }

  const sameTarget =
    _cache.printer && _cache.ip === printerIp && _cache.port === printerPort;

  const printer = sameTarget
    ? _cache.printer
    : await _connectAndCreatePrinter(printerIp, printerPort).catch(() => {
        _cache = { ip: null, port: null, device: null, printer: null };
        _enqueue({
          printerIp,
          printerPort,
          headerText,
          logoBase64,
          qrUrl,
          footerText,
          lines,
          title
        });
        throw new Error("Druck offline gespeichert (Verbindung fehlgeschlagen).");
      });

  return await new Promise((resolve, reject) => {
    const _printBody = (p) => {
      if (title) {
        p.addTextStyle(false, false, true, p.COLOR_1);
        p.addText(title + "\n");
        p.addTextStyle(false, false, false, p.COLOR_1);
        p.addText("\n");
      }

      p.addTextAlign(p.ALIGN_LEFT);

      for (const ln of lines) {
        if (typeof ln === "string") {
          p.addText(ln + "\n");
          continue;
        }

        const {
          text = "",
          align = "left",
          bold = false,
          size = "normal",
          feed = 0
        } = ln || {};

        if (align === "center") p.addTextAlign(p.ALIGN_CENTER);
        else if (align === "right") p.addTextAlign(p.ALIGN_RIGHT);
        else p.addTextAlign(p.ALIGN_LEFT);

        if (size === "large") p.addTextSize(2, 2);
        else if (size === "xlarge") p.addTextSize(3, 3);
        else p.addTextSize(1, 1);

        p.addTextStyle(false, false, !!bold, p.COLOR_1);
        p.addText(text + "\n");
        p.addTextStyle(false, false, false, p.COLOR_1);
        p.addTextSize(1, 1);

        if (feed) p.addFeedLine(feed);
      }

      _addQr(p, qrUrl);

      if (footerText) {
        p.addTextAlign(p.ALIGN_CENTER);
        p.addText("\n" + footerText + "\n");
        p.addTextAlign(p.ALIGN_LEFT);
      }

      _finalize(p);
    };

    const doPrint = (p) => {
      try {
        p.onreceive = (res) => {
          if (res.success) {
            if (!_skipFlush) _flushQueue();
            return resolve(res);
          }
          _enqueue({
            printerIp,
            printerPort,
            headerText,
            logoBase64,
            qrUrl,
            footerText,
            lines,
            title
          });
          reject(new Error("Druck offline gespeichert (Fehler beim Drucken)."));
        };

        p.addTextLang(p.LANG_DE);
        p.addTextFont(p.FONT_A);
        p.addTextSmooth(true);

        if (logoBase64 && logoBase64.startsWith("data:image/")) {
          try {
            const img = new Image();
            img.onload = () => {
              try {
                const canvas = document.createElement("canvas");
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext("2d");
                ctx.drawImage(img, 0, 0);

                const maxW = 500;
                const maxH = 300;
                let w = canvas.width;
                let h = canvas.height;

                let srcCanvas = canvas;
                if (w > maxW || h > maxH) {
                  const ratio = Math.min(maxW / w, maxH / h);
                  const c2 = document.createElement("canvas");
                  c2.width = Math.round(w * ratio);
                  c2.height = Math.round(h * ratio);
                  const ctx2 = c2.getContext("2d");
                  ctx2.drawImage(
                    canvas,
                    0,
                    0,
                    w,
                    h,
                    0,
                    0,
                    c2.width,
                    c2.height
                  );
                  srcCanvas = c2;
                }

                p.addTextAlign(p.ALIGN_CENTER);
                p.addImage(
                  srcCanvas,
                  0,
                  0,
                  srcCanvas.width,
                  srcCanvas.height,
                  p.COLOR_1
                );
                p.addText("\n");
                p.addTextAlign(p.ALIGN_LEFT);
              } catch {
                /* ignore */
              }

              if (headerText) p.addText(headerText + "\n\n");
              _printBody(p);
            };
            img.onerror = () => {
              if (headerText) p.addText(headerText + "\n\n");
              _printBody(p);
            };
            img.src = logoBase64;
            return;
          } catch {
            /* fall through */
          }
        }

        if (headerText) p.addText(headerText + "\n\n");
        _printBody(p);
      } catch {
        _enqueue({
          printerIp,
          printerPort,
          headerText,
          logoBase64,
          qrUrl,
          footerText,
          lines,
          title
        });
        reject(new Error("Druck offline gespeichert (Fehler beim Drucken)."));
      }
    };

    doPrint(printer);
  });
}
