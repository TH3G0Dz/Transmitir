import { copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const destination = path.resolve("vendor/cloudflared.exe");
if (!existsSync(destination)) {
  const candidates = [
    process.env.CLOUDFLARED_PATH,
    process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "cloudflared", "cloudflared.exe"),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "cloudflared", "cloudflared.exe")
  ].filter(Boolean);
  const installed = candidates.find(existsSync);
  if (!installed) throw new Error("Instale o cloudflared ou defina CLOUDFLARED_PATH antes de gerar o instalador.");
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(installed, destination);
}
