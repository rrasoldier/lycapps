#!/usr/bin/env bash
# Crée « Cursor Launcher.app » : un petit lanceur double-cliquable (Finder, Spotlight, Dock, éléments de
# connexion) qui démarre l'application depuis ce dossier, sans passer par le Terminal.
# Les mises à jour se font ensuite depuis l'icône de la barre de menus (ou automatiquement au démarrage).
#
# Usage : npm run app:install            -> ~/Applications/Cursor Launcher.app
#         npm run app:install -- /chemin -> dans un autre dossier
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="${1:-$HOME/Applications}"
APP="$TARGET_DIR/Cursor Launcher.app"

cd "$APP_DIR"
if [ ! -x node_modules/electron/dist/Electron.app/Contents/MacOS/Electron ] && [ "$(uname)" = "Darwin" ]; then
  echo "Installation des dépendances…"
  npm install
fi
if [ ! -f dist/main/main.js ]; then
  echo "Compilation…"
  npm run build
fi

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Cursor Launcher</string>
  <key>CFBundleDisplayName</key><string>Cursor Launcher</string>
  <key>CFBundleIdentifier</key><string>app.lycapps.cursor-launcher.starter</string>
  <key>CFBundleExecutable</key><string>launch</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSUIElement</key><true/>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
</dict>
</plist>
PLIST

# Le chemin du dossier est figé ici ; si vous déplacez le dossier, relancez `npm run app:install`.
cat > "$APP/Contents/MacOS/launch" <<LAUNCH
#!/bin/zsh -l
APP_DIR="$APP_DIR"
ELECTRON="\$APP_DIR/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
if [ ! -x "\$ELECTRON" ] || [ ! -f "\$APP_DIR/dist/main/main.js" ]; then
  osascript -e 'display dialog "Cursor Launcher est incomplet (dépendances ou compilation manquantes). Dans le Terminal : cd apps/launcher puis npm install && npm run build, puis relancez npm run app:install." buttons {"OK"} with icon caution'
  exit 1
fi
cd "\$APP_DIR"
exec "\$ELECTRON" "\$APP_DIR"
LAUNCH
chmod +x "$APP/Contents/MacOS/launch"

echo "Créé : $APP"
echo "Double-cliquez dessus (ou : open \"$APP\"). Pour le lancer à la connexion : Réglages Système → Général → Éléments de connexion → +"
