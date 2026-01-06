export function showModal({ title, bodyHtml, buttons }) {
  const modal = document.getElementById("modal");
  const t = document.getElementById("modalTitle");
  const b = document.getElementById("modalBody");
  const btns = document.getElementById("modalBtns");
  t.textContent = title || "";
  b.innerHTML = bodyHtml || "";
  btns.innerHTML = "";
  for (const bt of (buttons || [])) {
    const el = document.createElement("button");
    el.textContent = bt.text;
    el.className = bt.className || "";
    el.addEventListener("click", () => {
      if (bt.onClick) bt.onClick();
      hideModal();
    });
    btns.appendChild(el);
  }
  modal.classList.add("open");
  modal.addEventListener("click", (e) => { if (e.target === modal) hideModal(); }, { once:true });
}
export function hideModal() {
  document.getElementById("modal").classList.remove("open");
}