// public/assets/views/settings.js
import { getSettings, saveSettings, authStart } from "../app.js";
import { showModal } from "../modal.js";
import { eposPrint } from "../epos.js";

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export async function renderSettings(root) {
  const s = await getSettings();

  root.innerHTML = `
  <div class="panel">
    <h2>Einstellungen</h2>

    <div class="card">
      <h3>Microsoft / OneDrive</h3>
      <div class="row">
        <button id="connect" class="btn secondary">Microsoft verbinden</button>
        <div id="authMsg" class="muted"></div>
      </div>
      <p class="muted">Wenn Excel nicht erreicht wird, zuerst verbinden.</p>
    </div>

    <div class="card">
      <h3>Drucker</h3>
      <div class="grid">
        <label>IP</label>
        <input id="printerIp" placeholder="z.B. 192.168.1.50" value="${(s && s.printerIp) || ""}"/>

        <label>Port</label>
        <input id="printerPort" placeholder="8008" value="${(s && s.printerPort) || 8008}"/>
      </div>

      <div class="row mt">
        <button id="save" class="btn primary">Speichern</button>
        <button id="test" class="btn secondary">Testbon drucken</button>
        <div id="msg" class="muted"></div>
      </div>

      <p class="muted">Testbon: Verbindung + ePOS-Print prüfen.</p>
    </div>

    <div class="card">
      <h3>Bon Layout</h3>

      <label>Logo (optional)</label>
      <input id="logo" type="file" accept="image/*" />
      <div class="muted small">Empfohlen: PNG, nicht zu groß. Wird als Base64 gespeichert.</div>

      <label class="mt">Header Text</label>
      <textarea id="headerText" rows="3" placeholder="La Profumoteca&#10;Hauptgasse ...">${(s && s.headerText) || ""}</textarea>

      <label class="mt">QR-Code URL</label>
      <input id="qrUrl" placeholder="https://laprofumoteca.ch" value="${(s && s.qrUrl) || ""}"/>

      <label class="mt">Footer Text</label>
      <textarea id="footerText" rows="3" placeholder="Danke für Ihren Einkauf!">${(s && s.footerText) || ""}</textarea>
    </div>
  </div>
  `;

  const connectBtn = document.getElementById("connect");
  connectBtn.onclick = async () => {
    connectBtn.disabled = true;
    const oldText = connectBtn.textContent;
    connectBtn.textContent = "Öffne...";

    try {
      const r = await authStart();
      window.open(r.authUrl, "_blank");
      document.getElementById("authMsg").textContent =
        "Auth-Fenster geöffnet. Nach Abschluss hier zurückkommen.";
    } catch (e) {
      document.getElementById("authMsg").textContent = "Fehler: " + e.message;
    } finally {
      connectBtn.disabled = false;
      connectBtn.textContent = oldText;
    }
  };

  const saveBtn = document.getElementById("save");
  const testBtn = document.getElementById("test");
  const msg = document.getElementById("msg");

  async function collectSettings() {
    const printerIp = document.getElementById("printerIp").value.trim();
    const printerPort = parseInt(
      document.getElementById("printerPort").value.trim() || "8008",
      10
    );

    const headerText = document.getElementById("headerText").value;
    const qrUrl = document.getElementById("qrUrl").value.trim();
    const footerText = document.getElementById("footerText").value;

    let logoBase64 = s && s.logoBase64 ? s.logoBase64 : "";
    const logoFile = document.getElementById("logo").files[0];
    if (logoFile) logoBase64 = await fileToBase64(logoFile);

    return {
      printerIp,
      printerPort,
      headerText,
      logoBase64,
      qrUrl,
      footerText
    };
  }

  saveBtn.onclick = async () => {
    saveBtn.disabled = true;
    const oldText = saveBtn.textContent;
    saveBtn.textContent = "Speichere...";
    msg.textContent = "";

    try {
      const ns = await collectSettings();

      await saveSettings({
        printerIp: ns.printerIp,
        printerPort: ns.printerPort,
        headerText: ns.headerText,
        logoBase64: ns.logoBase64,
        qrUrl: ns.qrUrl,
        footerText: ns.footerText
      });

      msg.textContent = "Gespeichert ✅";
    } catch (e) {
      msg.textContent = "Fehler: " + e.message;
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = oldText;
    }
  };

  testBtn.onclick = async () => {
    testBtn.disabled = true;
    const oldText = testBtn.textContent;
    testBtn.textContent = "Drucke...";
    msg.textContent = "";
    saveBtn.disabled = true;

    try {
      const ns = await collectSettings();

      if (!ns.printerIp) {
        return showModal({
          title: "Drucker-IP fehlt",
          bodyHtml: "Bitte zuerst Drucker-IP speichern.",
          buttons: [{ text: "OK", className: "primary" }]
        });
      }

      await eposPrint({
        printerIp: ns.printerIp,
        printerPort: ns.printerPort || 8008,
        headerText: ns.headerText,
        logoBase64: ns.logoBase64,
        qrUrl: ns.qrUrl,
        footerText: ns.footerText,
        title: "*** TESTBON ***",
        lines: [
          "",
          `Datum: ${new Date().toLocaleDateString("de-CH")}`,
          "",
          "Wenn dieser Bon kommt:",
          "Direktdruck OK ✅"
        ]
      });

      msg.textContent = "Testbon gesendet ✅";
    } catch (e) {
      msg.textContent = "Druckfehler: " + e.message;
    } finally {
      testBtn.disabled = false;
      testBtn.textContent = oldText;
      saveBtn.disabled = false;
    }
  };
}
