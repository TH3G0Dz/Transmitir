const sources = document.getElementById("sources");
const refresh = document.getElementById("refresh");

function render(items) {
  sources.replaceChildren();
  for (const item of items) {
    const button = document.createElement("button");
    button.className = "source";
    button.type = "button";
    const image = document.createElement("img");
    image.src = item.thumbnail;
    image.alt = "";
    const label = document.createElement("span");
    label.textContent = item.name;
    button.append(image, label);
    button.addEventListener("click", () => window.desktopApp.selectSource(item.id));
    sources.append(button);
  }
}

window.desktopApp.onSources(render);
refresh.addEventListener("click", async () => {
  refresh.disabled = true;
  refresh.textContent = "Atualizando…";
  try { render(await window.desktopApp.refreshSources()); }
  finally { refresh.disabled = false; refresh.textContent = "Atualizar"; }
});

document.getElementById("cancel").addEventListener("click", () => window.desktopApp.cancelSource());
