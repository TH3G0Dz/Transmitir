import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, Menu, nativeImage, session, Tray } from "electron";
import { extractTunnelUrl, sameOrigin } from "./runtime.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const preload = path.join(here, "preload.cjs");
const icon = path.join(here, "assets", "icon.png");
let mainWindow;
let pickerWindow;
let pickerResolve;
let pickerSources = new Map();
let serverProcess;
let tunnelProcess;
let tray;
let publicOrigin;
let broadcasting = false;
let quitting = false;
let balloonShown = false;

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function availablePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => probe.listen(0, "127.0.0.1", (error) => error ? reject(error) : resolve()));
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForHealth(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok && (await response.json()).service === "webshare") return;
    } catch { /* Serviço ainda iniciando. */ }
    await wait(250);
  }
  throw new Error(`O serviço não respondeu em ${Math.round(timeoutMs / 1000)} segundos.`);
}

function cloudflaredPath() {
  if (app.isPackaged) return path.join(process.resourcesPath, "cloudflared.exe");
  const candidates = [
    path.join(app.getAppPath(), "vendor", "cloudflared.exe"),
    process.env.CLOUDFLARED_PATH,
    process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "cloudflared", "cloudflared.exe"),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "cloudflared", "cloudflared.exe")
  ].filter(Boolean);
  return candidates.find(existsSync);
}

function waitForTunnel(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error("O endereço público não foi criado em 60 segundos.")), 60_000);
    const read = (chunk) => {
      output = `${output}${chunk}`.slice(-20_000);
      const url = extractTunnelUrl(output);
      if (url) { clearTimeout(timeout); resolve(url); }
    };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`O túnel encerrou com código ${code}.`)); });
  });
}

function setBroadcasting(active) {
  broadcasting = active;
  const status = broadcasting ? "Transmitindo em segundo plano" : "Pronto";
  tray?.setContextMenu(Menu.buildFromTemplate([
    { label: "Abrir TH Transmissões", click: showWindow },
    { label: status, enabled: false },
    { type: "separator" },
    { label: "Sair", click: requestQuit }
  ]));
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.show();
  mainWindow.focus();
}

async function requestQuit() {
  if (broadcasting) {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      buttons: ["Continuar transmitindo", "Encerrar e sair"],
      defaultId: 0,
      cancelId: 0,
      title: "Transmissão ativa",
      message: "Sair encerrará a transmissão para todos os espectadores."
    });
    if (response === 0) return;
  }
  quitting = true;
  app.quit();
}

function finishPicker(sourceId) {
  if (!pickerResolve) return;
  const resolve = pickerResolve;
  pickerResolve = null;
  const window = pickerWindow;
  pickerWindow = null;
  if (window && !window.isDestroyed()) window.destroy();
  const source = pickerSources.get(sourceId) ?? null;
  pickerSources.clear();
  resolve(source);
}

async function captureSources() {
  const pickerId = pickerWindow?.getMediaSourceId();
  const sources = (await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 320, height: 180 } }))
    .filter((source) => source.id !== pickerId);
  pickerSources = new Map(sources.map((source) => [source.id, source]));
  return sources.map((source) => ({ id: source.id, name: source.name, thumbnail: source.thumbnail.toDataURL() }));
}

async function chooseSource() {
  if (pickerResolve) return null;
  const sources = await captureSources();
  pickerWindow = new BrowserWindow({
    parent: mainWindow,
    modal: true,
    width: 900,
    height: 650,
    minWidth: 620,
    minHeight: 420,
    show: false,
    title: "Escolher tela ou janela",
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  pickerWindow.setMenuBarVisibility(false);
  pickerWindow.on("closed", () => finishPicker(null));
  pickerWindow.once("ready-to-show", () => pickerWindow?.show());
  pickerWindow.webContents.once("did-finish-load", () => {
    pickerWindow?.webContents.send("desktop:sources", sources);
  });
  const choice = new Promise((resolve) => { pickerResolve = resolve; });
  await pickerWindow.loadFile(path.join(here, "picker.html"));
  return choice;
}

function configureCapture() {
  const trusted = (webContents, origin) => webContents === mainWindow?.webContents && sameOrigin(origin, publicOrigin);
  session.defaultSession.setPermissionCheckHandler((webContents, permission, origin) =>
    ["display-capture", "clipboard-sanitized-write"].includes(permission) && trusted(webContents, origin));
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) =>
    callback(["display-capture", "clipboard-sanitized-write"].includes(permission) && trusted(webContents, details.requestingUrl)));
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    if (!sameOrigin(request.securityOrigin, publicOrigin)) return callback(null);
    try {
      const source = await chooseSource();
      if (!source) return callback(null);
      callback({ video: source, ...(request.audioRequested ? { audio: "loopback" } : {}) });
    } catch { callback(null); }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 650,
    show: false,
    title: "TH Transmissões",
    icon,
    backgroundColor: "#0b1116",
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(here, "loading.html"));
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("did-start-navigation", () => setBroadcasting(false));
  const hideToTray = (event) => {
    event.preventDefault();
    mainWindow.hide();
    if (!balloonShown) {
      tray.displayBalloon({ title: "TH Transmissões", content: "A transmissão continua ativa na bandeja." });
      balloonShown = true;
    }
  };
  mainWindow.on("minimize", (event) => { if (broadcasting) hideToTray(event); });
  mainWindow.on("close", (event) => {
    if (quitting) return;
    if (broadcasting) {
      hideToTray(event);
      return;
    }
    quitting = true;
    app.quit();
  });
}

async function startServices() {
  const port = await availablePort();
  const localOrigin = `http://127.0.0.1:${port}`;
  const serverEntry = path.join(app.getAppPath(), "server", "index.js");
  serverProcess = spawn(process.execPath, [serverEntry], {
    cwd: app.isPackaged ? app.getPath("userData") : app.getAppPath(),
    windowsHide: true,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "development",
      HOST: "127.0.0.1",
      PORT: String(port),
      PUBLIC_ORIGIN: localOrigin,
      TRUST_PROXY_HOPS: "1",
      ALLOW_QUICK_TUNNEL: "true"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  await waitForHealth(localOrigin, 30_000);
  const executable = cloudflaredPath();
  if (!executable) throw new Error("cloudflared.exe não foi encontrado no aplicativo.");
  tunnelProcess = spawn(executable, ["tunnel", "--no-autoupdate", "--url", localOrigin], {
    cwd: app.getPath("userData"), windowsHide: true, stdio: ["ignore", "pipe", "pipe"]
  });
  publicOrigin = await waitForTunnel(tunnelProcess);
  await waitForHealth(publicOrigin, 120_000);
  await mainWindow.loadURL(`${publicOrigin}/host.html`);
}

function stopServices() {
  finishPicker(null);
  tunnelProcess?.kill();
  serverProcess?.kill();
}

ipcMain.on("desktop:broadcasting", (event, active) => {
  if (event.sender === mainWindow?.webContents) setBroadcasting(active === true);
});
ipcMain.on("desktop:source-selected", (event, id) => {
  if (event.sender === pickerWindow?.webContents) finishPicker(typeof id === "string" ? id : null);
});
ipcMain.handle("desktop:refresh-sources", async (event) => {
  if (event.sender !== pickerWindow?.webContents) return [];
  return captureSources();
});

if (hasSingleInstanceLock) app.on("second-instance", showWindow);
app.on("before-quit", () => { quitting = true; stopServices(); });
app.on("activate", showWindow);

if (hasSingleInstanceLock) app.whenReady().then(async () => {
  app.setAppUserModelId("br.com.thtransmissoes.app");
  createWindow();
  configureCapture();
  const image = nativeImage.createFromPath(icon).resize({ width: 16, height: 16 });
  tray = new Tray(image);
  tray.setToolTip("TH Transmissões");
  tray.on("click", showWindow);
  setBroadcasting(false);
  try { await startServices(); }
  catch (error) {
    await dialog.showMessageBox(mainWindow, { type: "error", title: "TH Transmissões", message: "Não foi possível iniciar o aplicativo.", detail: error.message });
    quitting = true;
    app.quit();
  }
});
