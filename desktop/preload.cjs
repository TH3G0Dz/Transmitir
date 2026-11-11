const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopApp", {
  setBroadcasting: (active) => ipcRenderer.send("desktop:broadcasting", active === true),
  selectSource: (id) => ipcRenderer.send("desktop:source-selected", id),
  cancelSource: () => ipcRenderer.send("desktop:source-selected", null),
  refreshSources: () => ipcRenderer.invoke("desktop:refresh-sources"),
  onSources: (callback) => ipcRenderer.once("desktop:sources", (_event, sources) => callback(sources))
});
