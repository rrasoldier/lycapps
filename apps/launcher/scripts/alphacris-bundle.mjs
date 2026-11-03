// Transforme une copie d'Electron.app en « AlphaCris.app » : nom, identifiant et textes d'usage dans Info.plist,
// plus un petit dossier Resources/app qui charge le code de ce dépôt (dist/main/main.js).
// Usage : node scripts/alphacris-bundle.mjs <chemin/AlphaCris.app> <dossier apps/launcher>
import fs from "node:fs";
import path from "node:path";

const [bundle, appDir] = process.argv.slice(2);
if (!bundle || !appDir) {
  console.error("Usage : alphacris-bundle.mjs <AlphaCris.app> <dossier de l'app>");
  process.exit(2);
}

const NAME = "AlphaCris";
const plistPath = path.join(bundle, "Contents", "Info.plist");
let plist = fs.readFileSync(plistPath, "utf8");
if (!plist.includes("<plist")) throw new Error("Info.plist n'est pas au format XML (lancer `plutil -convert xml1` avant).");

const esc = (v) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function setKey(key, value) {
  const xml = typeof value === "boolean" ? (value ? "<true/>" : "<false/>") : `<string>${esc(value)}</string>`;
  const existing = new RegExp(`(<key>${key}</key>\\s*)(<string>[^<]*</string>|<true/>|<false/>)`);
  if (existing.test(plist)) plist = plist.replace(existing, (_m, k) => `${k}${xml}`);
  else plist = plist.replace(/<\/dict>\s*<\/plist>\s*$/, `\t<key>${key}</key>\n\t${xml}\n</dict>\n</plist>\n`);
}

setKey("CFBundleName", NAME);
setKey("CFBundleDisplayName", NAME);
setKey("CFBundleIdentifier", "app.lycapps.alphacris");
setKey("LSUIElement", true);
setKey("NSMicrophoneUsageDescription", `${NAME} utilise le micro pour la conversation vocale.`);
setKey("NSAppleEventsUsageDescription", `${NAME} peut ouvrir et piloter des applications à votre demande.`);
setKey("NSDocumentsFolderUsageDescription", `${NAME} lit et range les fichiers que vous autorisez.`);
setKey("NSDesktopFolderUsageDescription", `${NAME} lit et range les fichiers que vous autorisez.`);
setKey("NSDownloadsFolderUsageDescription", `${NAME} lit et range les fichiers que vous autorisez.`);
fs.writeFileSync(plistPath, plist);

// Le nom interne reste « Cursor Launcher » : il détermine le dossier de données et l'entrée du Trousseau,
// donc réglages, historique et clé API restent ceux d'avant le renommage.
const resources = path.join(bundle, "Contents", "Resources", "app");
fs.rmSync(resources, { recursive: true, force: true });
fs.mkdirSync(resources, { recursive: true });
fs.writeFileSync(path.join(resources, "package.json"), JSON.stringify({ name: "cursor-launcher", productName: "Cursor Launcher", version: "0.1.0", main: "main.js" }, null, 2));
fs.writeFileSync(path.join(resources, "main.js"), `require(${JSON.stringify(path.join(path.resolve(appDir), "dist", "main", "main.js"))});\n`);
console.log(`${NAME} : Info.plist et Resources/app prêts.`);
