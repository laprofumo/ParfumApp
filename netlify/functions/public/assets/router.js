// public/assets/router.js
import { renderCreate } from "./views/create.js";
import { renderSearch } from "./views/search.js";
import { renderSettings } from "./views/settings.js";
import { getSettings } from "./app.js";
import { eposWarmup } from "./epos.js";

const app = document.getElementById("app");

function setActive(hash) {
  const m = {
    "#/create": "nav-create",
    "#/search": "nav-search",
    "#/settings": "nav-settings"
  };
  for (const id of Object.values(m))
    document.getElementById(id).classList.remove("active");
  const key = m[hash] || "nav-create";
  document.getElementById(key).classList.add("active");
}

let _warmupStarted = false;
async function maybeWarmupPrinter() {
  if (_warmupStarted) return;
  _warmupStarted = true;
  try {
    const s = await getSettings();
    if (!s || !s.printerIp) return;
    await eposWarmup({
      printerIp: s.printerIp,
      printerPort: s.printerPort || 8008
    });
  } catch {
    // ignore
  }
}

async function route() {
  const hash = location.hash || "#/create";
  setActive(hash);

  if (hash.startsWith("#/settings")) await renderSettings(app);
  else if (hash.startsWith("#/search")) await renderSearch(app);
  else await renderCreate(app);

  maybeWarmupPrinter();
}

window.addEventListener("hashchange", route);
route();
