// public/assets/views/create.js
import { getSettings, excelAppend, excelGetRow, todayCH, parseMlInput } from "../app.js";
import { showModal } from "../modal.js";
import { eposPrint } from "../epos.js";

function formatOptions() {
  return `
    <option value="15">15</option>
    <option value="30">30</option>
    <option value="50">50</option>
    <option value="100">100</option>
    <option value="custom">Individuell</option>
  `;
}

function concOptions() {
  return `
    <option value="EDT">EDT</option>
    <option value="EDP" selected>EDP</option>
    <option value="EXDP">EXDP</option>
  `;
}

function getVal(id) {
  const el = document.getElementById(id);
  return el ? el.value : "";
}
function setVal(id, v) {
  const el = document.getElementById(id);
  if (el) el.value = v;
}

let lastSaved = null;

function modalConfirm({ title, bodyHtml, okText = "OK", cancelText = "Abbrechen" }) {
  return new Promise((resolve) => {
    showModal({
      title,
      bodyHtml,
      buttons: [
        {
          text: cancelText,
          onClick: () => resolve(false)
        },
        {
          text: okText,
          className: "primary",
          onClick: () => resolve(true)
        }
      ]
    });
  });
}

export async function renderCreate(root) {
  root.innerHTML = `
    <div class="card">
      <h2 style="margin:0 0 8px">Neue Parfümkreation</h2>
      <small>Speichern schreibt eine neue Zeile in Excel. Rechenwerte kommen aus Excel.</small>
    </div>

    <div class="card">
      <div class="row">
        <div>
          <label>Name Fragrance</label>
          <input id="namefragrance" placeholder="Name der Kreation" />
        </div>
      </div>

      <div class="row">
        <div>
          <label>Vorname</label>
          <input id="vorname" />
        </div>
        <div>
          <label>Nachname</label>
          <input id="nachname" />
        </div>
      </div>

      <div class="row">
        <div>
          <label>E-Mail</label>
          <input id="email" inputmode="email" placeholder="name@domain.ch" />
        </div>
        <div></div>
      </div>

      <div class="row">
        <div>
          <label>Konzentration</label>
          <select id="konz">${concOptions()}</select>
        </div>
        <div>
          <label>Format ml</label>
          <select id="format">${formatOptions()}</select>
        </div>
      </div>

      <div class="row">
        <div>
          <label>%/1</label>
          <input id="p1" inputmode="decimal" />
        </div>
        <div>
          <label>Duft 1</label>
          <input id="d1" />
        </div>
      </div>

      <div class="row">
        <div>
          <label>%/2</label>
          <input id="p2" inputmode="decimal" />
        </div>
        <div>
          <label>Duft 2</label>
          <input id="d2" />
        </div>
      </div>

      <div class="row">
        <div>
          <label>%/3</label>
          <input id="p3" inputmode="decimal" />
        </div>
        <div>
          <label>Duft 3</label>
          <input id="d3" />
        </div>
      </div>

      <label>Bemerkungen</label>
      <textarea id="bem"></textarea>

      <div class="row">
        <div>
          <label>g Duft 1 (Excel)</label>
          <input id="g1" disabled />
        </div>
        <div>
          <label>g Duft 2 (Excel)</label>
          <input id="g2" disabled />
        </div>
      </div>
      <div class="row">
        <div>
          <label>g Duft 3 (Excel)</label>
          <input id="g3" disabled />
        </div>
        <div>
          <label>Total % (Excel)</label>
          <input id="tot" disabled />
        </div>
      </div>

      <div class="btns">
        <button class="primary" id="save">Speichern</button>
        <button id="print">Drucken</button>
        <button class="danger" id="clear">Alles löschen</button>
      </div>

      <small id="msg"></small>
    </div>
  `;

  const msg = document.getElementById("msg");
  const saveBtn = document.getElementById("save");
  const printBtn = document.getElementById("print");
  const clearBtn = document.getElementById("clear");

  // Printing is only allowed after a successful save
  printBtn.disabled = true;

  const clearCreationFieldsKeepCustomer = () => {
    ["namefragrance", "p1", "d1", "p2", "d2", "p3", "d3", "bem", "g1", "g2", "g3", "tot"].forEach((id) => setVal(id, ""));
    setVal("konz", "EDP");
    setVal("format", "15");
    lastSaved = null;
    printBtn.disabled = true;
  };

  // Format: custom popup
  document.getElementById("format").addEventListener("change", () => {
    const v = getVal("format");
    if (v === "custom") {
      showModal({
        title: "Individuelles Format (ml)",
        bodyHtml: `<label>ml (ganze Zahl)</label><input id="customMl" inputmode="numeric" placeholder="z.B. 120" />`,
        buttons: [
          {
            text: "OK",
            className: "primary",
            onClick: () => {
              const n = parseMlInput(document.getElementById("customMl").value);
              document.getElementById("format").dataset.custom = String(n);
            }
          }
        ]
      });
    } else {
      delete document.getElementById("format").dataset.custom;
    }
  });

  const getCustomerInfo = () => `${getVal("vorname").trim()} ${getVal("nachname").trim()}`.trim();

  async function precheckCustomerExistingOrCreateAllowed() {
    const fn = getVal("vorname").trim();
    const ln = getVal("nachname").trim();
    const emailRaw = getVal("email").trim();

    // Call the existing Netlify function (it returns status: created|existing)
    const cRes = await fetch("/.netlify/functions/shopify-customer-find-or-create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firstName: fn, lastName: ln, email: emailRaw })
    });

    const cJson = await cRes.json().catch(() => ({}));
    if (!cRes.ok) {
      throw new Error(cJson?.error || "Shopify Kunde Fehler.");
    }

    // If existing, ask BEFORE saving the creation
    if (cJson.status === "existing") {
      const ok = await modalConfirm({
        title: "Bestehender Kunde",
        bodyHtml: "Kunde existiert bereits. Kreation trotzdem speichern?",
        okText: "Speichern",
        cancelText: "Abbrechen"
      });
      if (!ok) return { proceed: false, status: "existing" };
    }

    return { proceed: true, status: cJson.status || null };
  }

  async function doSave() {
    const fn = getVal("vorname").trim();
    const ln = getVal("nachname").trim();
    const emailRaw = getVal("email").trim();

    if (!fn || !ln) throw new Error("Vorname und Nachname fehlen.");
    if (!emailRaw) throw new Error("E-Mail fehlt.");

    const formatSel = getVal("format");
    const formatMl = formatSel === "custom" ? Number(document.getElementById("format").dataset.custom || "") : Number(formatSel);
    if (!formatMl) throw new Error("Format fehlt (oder individuelles Format nicht bestätigt).");

    // Precheck (Shopify): existing? -> ask before save
    const pre = await precheckCustomerExistingOrCreateAllowed();
    if (!pre.proceed) {
      msg.textContent = "Abgebrochen.";
      return;
    }

    const payload = {
      Kundeninfo: getCustomerInfo().trim(),
      Email: emailRaw.toLowerCase(),
      "Name Fragrance": getVal("namefragrance").trim(),
      Konzentration: getVal("konz"),
      "%/1": getVal("p1"),
      "Duft 1": getVal("d1"),
      "%/2": getVal("p2"),
      "Duft 2": getVal("d2"),
      "%/3": getVal("p3"),
      "Duft 3": getVal("d3"),
      "Format ml": formatMl,
      "Datum Kauf": todayCH(),
      Bemerkungen: getVal("bem")
    };

    // Single call that saves to Shopify + Excel (your Netlify function excel-append does both now)
    const r = await excelAppend(payload);
    const full = await excelGetRow(r.row);

    lastSaved = { row: r.row, payload, fullRow: full };

    setVal("g1", full["g Duft 1"] || "");
    setVal("g2", full["g Duft 2"] || "");
    setVal("g3", full["g Duft 3"] || "");
    setVal("tot", full["Total %"] || "");

    msg.textContent = `Gespeichert ✅ (Zeile ${r.row})`;
    printBtn.disabled = false;
  }

  async function doPrintFirstCreation() {
    const s = await getSettings();
    if (!s.printer?.ip) throw new Error("Drucker-IP fehlt (Einstellungen).");
    if (!(window.epson && window.epson.ePOSDevice)) throw new Error("Epson SDK fehlt: /assets/epos-device.js");

    const full = lastSaved?.fullRow;
    if (!full) throw new Error("Bitte zuerst speichern.");

    const lines = [
      `Kunde: ${full["Kundeninfo"]}`,
      `Fragrance: ${full["Name Fragrance"]}`,
      `Konzentration: ${full["Konzentration"]}`,
      { text: `Format: ${full["Format ml"] ?? ""} ml`, size: 2 },
      ""
    ];

    const blocks = [
      { d: full["Duft 1"], g: full["g Duft 1"] },
      { d: full["Duft 2"], g: full["g Duft 2"] },
      { d: full["Duft 3"], g: full["g Duft 3"] }
    ];

    for (const b of blocks) {
      const d = String(b.d || "").trim();
      if (!d) continue;
      lines.push({ text: d, size: 2 });
      lines.push({ text: `${String(b.g ?? "").toString()} g`, bold: true });
      lines.push("");
    }

    lines.push(`Erstellungsdatum: ${full["Datum Kauf"]}`);

    await eposPrint({
      printerIp: s.printer.ip,
      printerPort: s.printer.port || 8008,
      headerText: s.receipt.headerText,
      logoBase64: s.receipt.logoBase64,
      qrUrl: s.receipt.qrUrl,
      footerText: s.receipt.footerText,
      lines
    });

    msg.textContent = "Bon gesendet ✅";
  }

  saveBtn.onclick = async () => {
    saveBtn.disabled = true;
    const oldText = saveBtn.textContent;
    saveBtn.textContent = "Speichere...";

    printBtn.disabled = true;
    clearBtn.disabled = true;

    try {
      await doSave();
    } catch (e) {
      msg.textContent = "Fehler: " + e.message;
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = oldText;
      printBtn.disabled = !lastSaved;
      clearBtn.disabled = false;
    }
  };

  printBtn.onclick = async () => {
    printBtn.disabled = true;
    const oldText = printBtn.textContent;
    printBtn.textContent = "Drucke...";

    saveBtn.disabled = true;
    clearBtn.disabled = true;

    try {
      if (!lastSaved) throw new Error("Bitte zuerst speichern.");
      await doPrintFirstCreation();

      // After successful print: only clear creation fields, keep customer
      clearCreationFieldsKeepCustomer();
      msg.textContent = "Bereit für weitere Kreation (Kunde bleibt).";
    } catch (e) {
      msg.textContent = "Fehler: " + e.message;
    } finally {
      printBtn.textContent = oldText;
      printBtn.disabled = !lastSaved;
      saveBtn.disabled = false;
      clearBtn.disabled = false;
    }
  };

  clearBtn.onclick = () => {
    clearBtn.disabled = true;
    const oldText = clearBtn.textContent;
    clearBtn.textContent = "Lösche...";

    try {
      ["vorname", "nachname", "email", "namefragrance", "p1", "d1", "p2", "d2", "p3", "d3", "bem", "g1", "g2", "g3", "tot"].forEach((id) =>
        setVal(id, "")
      );
      setVal("konz", "EDP");
      setVal("format", "15");
      lastSaved = null;
      printBtn.disabled = true;
      msg.textContent = "Geleert.";
    } finally {
      clearBtn.disabled = false;
      clearBtn.textContent = oldText;
    }
  };
}
