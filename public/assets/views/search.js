// public/assets/views/search.js
import {
  getSettings,
  excelSearch,
  excelGetRow,
  excelRefill,
  todayCH,
  parseMlInput,
  mlToG
} from "../app.js";
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

let selectedRow = null;
let selectedData = null;

function round1(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return Math.round(n * 10) / 10;
}

function readFormatMl(d) {
  const candidates = [
    "Format",
    "Format (ml)",
    "Format ml",
    "Flakon",
    "Menge",
    "Menge (ml)",
    "ml",
    "Füllmenge",
    "Fuellmenge"
  ];

  for (const k of candidates) {
    if (d && d[k] !== undefined && d[k] !== null && String(d[k]).trim() !== "") {
      const raw = String(d[k]).trim();
      const num = Number(raw.replace(",", "."));
      if (Number.isFinite(num) && num > 0) return num;
      return raw;
    }
  }
  return "";
}

function buildRecipeLinesFromSelected() {
  const a = selectedData?.["Kundeninfo"] || "";
  const b = selectedData?.["Name Fragrance"] || "";
  const c = selectedData?.["Konzentration"] || "";

  const d1 = selectedData?.["Duft 1"] || "";
  const d2 = selectedData?.["Duft 2"] || "";
  const d3 = selectedData?.["Duft 3"] || "";

  const g1raw = selectedData?.["g Duft 1"];
  const g2raw = selectedData?.["g Duft 2"];
  const g3raw = selectedData?.["g Duft 3"];

  const g1 = g1raw === "" || g1raw === null || g1raw === undefined ? "" : round1(g1raw);
  const g2 = g2raw === "" || g2raw === null || g2raw === undefined ? "" : round1(g2raw);
  const g3 = g3raw === "" || g3raw === null || g3raw === undefined ? "" : round1(g3raw);

  const o = selectedData?.["Datum"] || selectedData?.["Erstellungsdatum"] || "";

  const fmt = readFormatMl(selectedData);

  const lines = [];

  if (a) lines.push({ text: a, bold: true, size: "normal" });
  if (b) lines.push({ text: b, size: "normal" });
  if (c) lines.push({ text: c, size: "normal" });
  if (fmt !== "" && fmt !== null && fmt !== undefined) {
    if (typeof fmt === "number") lines.push({ text: `Format: ${fmt} ml`, bold: true, size: "large" });
    else lines.push({ text: `Format: ${fmt}`, bold: true, size: "large" });
  }
  lines.push("");

  if (d1) lines.push({ text: d1, bold: true, size: "large" });
  if (g1 !== "" && g1 !== null && g1 !== undefined) lines.push({ text: `${g1} g`, bold: true, size: "normal" });
  if (d1 || g1 !== "") lines.push("");

  if (d2) lines.push({ text: d2, bold: true, size: "large" });
  if (g2 !== "" && g2 !== null && g2 !== undefined) lines.push({ text: `${g2} g`, bold: true, size: "normal" });
  if (d2 || g2 !== "") lines.push("");

  if (d3) lines.push({ text: d3, bold: true, size: "large" });
  if (g3 !== "" && g3 !== null && g3 !== undefined) lines.push({ text: `${g3} g`, bold: true, size: "normal" });
  if (d3 || g3 !== "") lines.push("");

  if (o) lines.push({ text: `Erstellt: ${o}`, size: "normal" });

  return lines;
}

function calcRefillGramsFromSelected(ml) {
  const p1 = Number(selectedData?.["Duft 1 %"] ?? 0);
  const p2 = Number(selectedData?.["Duft 2 %"] ?? 0);
  const p3 = Number(selectedData?.["Duft 3 %"] ?? 0);

  const g1 = (ml * (p1 / 100)) / 1.19;
  const g2 = (ml * (p2 / 100)) / 1.19;
  const g3 = (ml * (p3 / 100)) / 1.19;

  return {
    g1: round1(g1),
    g2: round1(g2),
    g3: round1(g3)
  };
}

function buildRefillLines(ml, refillDate) {
  const d1 = selectedData?.["Duft 1"] || "";
  const d2 = selectedData?.["Duft 2"] || "";
  const d3 = selectedData?.["Duft 3"] || "";

  const grams = calcRefillGramsFromSelected(ml);

  const lines = [];

  lines.push({
    text: `Erstellt: ${selectedData?.["Datum"] || ""}`,
    size: "normal"
  });
  lines.push({ text: `Auffüllung: ${refillDate}`, size: "normal" });
  lines.push({ text: `Format: ${ml} ml`, bold: true, size: "large" });
  lines.push("");

  if (d1) lines.push({ text: d1, bold: true, size: "large" });
  if (d1) lines.push({ text: `${grams.g1} g`, bold: true, size: "normal" });
  if (d1) lines.push("");

  if (d2) lines.push({ text: d2, bold: true, size: "large" });
  if (d2) lines.push({ text: `${grams.g2} g`, bold: true, size: "normal" });
  if (d2) lines.push("");

  if (d3) lines.push({ text: d3, bold: true, size: "large" });
  if (d3) lines.push({ text: `${grams.g3} g`, bold: true, size: "normal" });
  if (d3) lines.push("");

  return lines;
}

export async function renderSearch(root) {
  root.innerHTML = `
    <div class="panel">
      <h2>Kunde suchen</h2>

      <div class="card">
        <div class="row">
          <input id="q" placeholder="Name / Fragrance suchen..." autocomplete="off"/>
          <button id="go" class="btn primary">Suchen</button>
        </div>
        <div id="msg" class="muted mt"></div>
      </div>

      <div class="card">
        <h3>Treffer</h3>
        <div class="tableWrap">
          <table class="table">
            <thead>
              <tr>
                <th>Kunde</th>
                <th>Fragrance</th>
                <th>Konz.</th>
              </tr>
            </thead>
            <tbody id="rows"></tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <h3>Auswahl</h3>
        <div id="detail" class="muted">Bitte einen Treffer auswählen.</div>

        <div class="row mt">
          <button id="print" class="btn secondary" disabled>Rezeptur drucken</button>
          <button id="refill" class="btn secondary" disabled>Parfüm auffüllen</button>
          <div id="dmsg" class="muted"></div>
        </div>
      </div>
    </div>
  `;

  const q = document.getElementById("q");
  const goBtn = document.getElementById("go");
  const msg = document.getElementById("msg");
  const rowsEl = document.getElementById("rows");
  const detail = document.getElementById("detail");
  const printBtn = document.getElementById("print");
  const refillBtn = document.getElementById("refill");
  const dmsg = document.getElementById("dmsg");

  let debounceTimer = null;

  function clearSelection() {
    selectedRow = null;
    selectedData = null;
    detail.textContent = "Bitte einen Treffer auswählen.";
    printBtn.disabled = true;
    refillBtn.disabled = true;
  }

  function renderRows(list) {
    rowsEl.innerHTML = "";
    clearSelection();

    if (!list || !list.length) {
      rowsEl.innerHTML = `<tr><td colspan="3" class="muted">Keine Treffer.</td></tr>`;
      return;
    }

    for (const r of list) {
      const tr = document.createElement("tr");
      tr.className = "clickable";
      tr.innerHTML = `<td>${r["Kundeninfo"] || ""}</td><td>${r["Name Fragrance"] || ""}</td><td>${r["Konzentration"] || ""}</td>`;
      tr.onclick = async () => {
        dmsg.textContent = "";
        clearSelection();
        selectedRow = r.row;

        try {
          const full = await excelGetRow(selectedRow);
          selectedData = full;

          const e = full["Duft 1"] || "";
          const h = full["Duft 2"] || "";
          const k = full["Duft 3"] || "";

          detail.innerHTML = `
            <div class="big">${e}</div>
            <div class="big">${h}</div>
            <div class="big">${k}</div>
          `;

          printBtn.disabled = false;
          refillBtn.disabled = false;
        } catch (e) {
          dmsg.textContent = "Fehler: " + e.message;
        }
      };
      rowsEl.appendChild(tr);
    }
  }

  async function doSearch() {
    const query = q.value.trim();
    msg.textContent = "";
    if (!query) {
      rowsEl.innerHTML = "";
      clearSelection();
      return;
    }

    const res = await excelSearch(query);
    renderRows(res?.results || []);
    msg.textContent = `${(res?.results || []).length} Treffer`;
  }

  q.addEventListener("input", () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      goBtn.disabled = true;
      const oldText = goBtn.textContent;
      goBtn.textContent = "Suche...";
      msg.textContent = "";
      try {
        await doSearch();
      } catch (e) {
        msg.textContent = "Fehler: " + e.message;
      } finally {
        goBtn.disabled = false;
        goBtn.textContent = oldText;
      }
    }, 250);
  });

  goBtn.onclick = async () => {
    goBtn.disabled = true;
    const oldText = goBtn.textContent;
    goBtn.textContent = "Suche...";
    msg.textContent = "";
    try {
      await doSearch();
    } catch (e) {
      msg.textContent = "Fehler: " + e.message;
    } finally {
      goBtn.disabled = false;
      goBtn.textContent = oldText;
    }
  };

  async function printFromExcel(title = "") {
    const s = await getSettings();
    if (!s.printerIp) throw new Error("Drucker-IP fehlt (Einstellungen).");
    if (!selectedData) throw new Error("Bitte zuerst einen Treffer auswählen.");

    const lines = buildRecipeLinesFromSelected();

    await eposPrint({
      printerIp: s.printerIp,
      printerPort: s.printerPort || 8008,
      headerText: s.headerText,
      logoBase64: s.logoBase64,
      qrUrl: s.qrUrl,
      footerText: s.footerText,
      title,
      lines
    });
  }

  printBtn.onclick = async () => {
    dmsg.textContent = "";
    printBtn.disabled = true;
    const oldText = printBtn.textContent;
    printBtn.textContent = "Drucke...";
    try {
      await printFromExcel("");
      dmsg.textContent = "Bon gesendet ✅";
    } catch (e) {
      dmsg.textContent = "Fehler: " + e.message;
    } finally {
      printBtn.disabled = false;
      printBtn.textContent = oldText;
    }
  };

  refillBtn.onclick = async () => {
    dmsg.textContent = "";
    refillBtn.disabled = true;
    const oldText = refillBtn.textContent;
    refillBtn.textContent = "Öffne...";
    try {
      if (!selectedRow || !selectedData)
        throw new Error("Bitte zuerst einen Treffer auswählen.");

      await showModal({
        title: "Parfüm auffüllen",
        bodyHtml: `
          <div class="grid">
            <label>Format (ml)</label>
            <select id="rfmt">${formatOptions()}</select>

            <div id="customWrap" style="display:none;">
              <label class="mt">Individuell (ml)</label>
              <input id="rcustom" placeholder="z.B. 120"/>
            </div>
          </div>
        `,
        buttons: [
          {
            text: "Speichern + drucken",
            className: "primary",
            onClick: async () => {
              const sel = document.getElementById("rfmt");
              const custom = document.getElementById("rcustom");
              const date = todayCH();

              let ml;
              if (sel.value === "custom") ml = parseMlInput(custom.value);
              else ml = Number(sel.value);

              await excelRefill(selectedRow, ml, date);

              const s = await getSettings();
              if (!s.printerIp) throw new Error("Drucker-IP fehlt (Einstellungen).");

              const lines = buildRefillLines(ml, date);

              await eposPrint({
                printerIp: s.printerIp,
                printerPort: s.printerPort || 8008,
                headerText: s.headerText,
                logoBase64: s.logoBase64,
                qrUrl: s.qrUrl,
                footerText: s.footerText,
                title: "AUFFÜLLUNG",
                lines
              });

              dmsg.textContent = "Auffüllung gespeichert + Bon gesendet ✅";
            }
          },
          { text: "Abbrechen" }
        ]
      });

      setTimeout(() => {
        const sel = document.getElementById("rfmt");
        const wrap = document.getElementById("customWrap");
        if (!sel) return;
        sel.onchange = () => {
          wrap.style.display = sel.value === "custom" ? "block" : "none";
        };
      }, 0);
    } catch (e) {
      dmsg.textContent = "Fehler: " + e.message;
    } finally {
      refillBtn.disabled = false;
      refillBtn.textContent = oldText;
    }
  };
}
