import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const script = path.join(__dirname, "../scripts/install-mac-app.sh");
const PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
\t<key>CFBundleDisplayName</key>
\t<string>Electron</string>
\t<key>CFBundleIdentifier</key>
\t<string>com.github.Electron</string>
\t<key>CFBundleName</key>
\t<string>Electron</string>
</dict>
</plist>
`;

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "install-app-"));
  const electron = path.join(root, "src", "Electron.app");
  fs.mkdirSync(path.join(electron, "Contents", "MacOS"), { recursive: true });
  fs.writeFileSync(path.join(electron, "Contents", "MacOS", "Electron"), "#!/bin/sh\n", { mode: 0o755 });
  fs.writeFileSync(path.join(electron, "Contents", "Info.plist"), PLIST);
  return { root, electron, target: path.join(root, "Applications") };
}

describe("app:install produit AlphaCris.app", () => {
  it("copie Electron, renomme le bundle et charge le code du dépôt", () => {
    const { electron, target } = fixture();
    execFileSync("bash", [script, target], { env: { ...process.env, ELECTRON_APP_SRC: electron } });
    expect(fs.readdirSync(target)).toEqual(["AlphaCris.app"]);
    const plist = fs.readFileSync(path.join(target, "AlphaCris.app/Contents/Info.plist"), "utf8");
    expect(plist).toMatch(/<key>CFBundleName<\/key>\s*<string>AlphaCris<\/string>/);
    expect(plist).toMatch(/<key>CFBundleDisplayName<\/key>\s*<string>AlphaCris<\/string>/);
    expect(plist).toContain("app.lycapps.alphacris");
    expect(plist).not.toContain("com.github.Electron");
    const shim = fs.readFileSync(path.join(target, "AlphaCris.app/Contents/Resources/app/main.js"), "utf8");
    expect(shim).toContain(path.join("dist", "main", "main.js"));
    const pkg = JSON.parse(fs.readFileSync(path.join(target, "AlphaCris.app/Contents/Resources/app/package.json"), "utf8"));
    expect(pkg.productName).toBe("Cursor Launcher");
  });

  it("remplace l'ancien « Cursor Launcher.app » et se réinstalle sans erreur", () => {
    const { electron, target } = fixture();
    const old = path.join(target, "Cursor Launcher.app", "Contents");
    fs.mkdirSync(old, { recursive: true });
    fs.writeFileSync(path.join(old, "Info.plist"), "app.lycapps.cursor-launcher.starter");
    const env = { ...process.env, ELECTRON_APP_SRC: electron };
    execFileSync("bash", [script, target], { env });
    execFileSync("bash", [script, target], { env });
    expect(fs.readdirSync(target)).toEqual(["AlphaCris.app"]);
  });

  it("se rabat sur un lanceur de secours si la copie d'Electron est impossible", () => {
    const { root, target } = fixture();
    execFileSync("bash", [script, target], { env: { ...process.env, ELECTRON_APP_SRC: path.join(root, "absent") }, stdio: "pipe" });
    expect(fs.existsSync(path.join(target, "AlphaCris.app/Contents/MacOS/launch"))).toBe(true);
    expect(fs.readFileSync(path.join(target, "AlphaCris.app/Contents/Info.plist"), "utf8")).toContain("<string>AlphaCris</string>");
  });
});
