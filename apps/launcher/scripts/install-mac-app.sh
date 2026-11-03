#!/usr/bin/env bash
# Crée « AlphaCris.app » : une vraie application macOS (copie d'Electron renommée) que l'on lance depuis le Finder,
# Spotlight ou le Dock, sans Terminal. Elle charge le code de ce dossier ; les mises à jour se font depuis l'app
# (icône de la barre de menus, Dock ou réglages) ou automatiquement au démarrage.
#
# Usage : npm run app:install            -> ~/Applications/AlphaCris.app
#         npm run app:install -- /chemin -> dans un autre dossier
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="${1:-$HOME/Applications}"
NAME="AlphaCris"
APP="$TARGET_DIR/$NAME.app"
ELECTRON_APP="${ELECTRON_APP_SRC:-$APP_DIR/node_modules/electron/dist/Electron.app}"

cd "$APP_DIR"
if [ ! -x "$ELECTRON_APP/Contents/MacOS/Electron" ] && [ "$(uname)" = "Darwin" ]; then
  echo "Installation des dépendances…"
  npm install
fi
if [ ! -f dist/main/main.js ]; then
  echo "Compilation…"
  npm run build
fi

mkdir -p "$TARGET_DIR"

# Ancienne version (avant le renommage) : un simple lanceur nommé « Cursor Launcher.app ».
OLD="$TARGET_DIR/Cursor Launcher.app"
if [ -d "$OLD" ] && grep -q "cursor-launcher.starter" "$OLD/Contents/Info.plist" 2>/dev/null; then
  echo "Suppression de l'ancien lanceur « Cursor Launcher.app » (remplacé par $NAME.app)."
  rm -rf "$OLD"
fi

make_bundle() {
  [ -x "$ELECTRON_APP/Contents/MacOS/Electron" ] || return 1
  rm -rf "$APP"
  { cp -Rc "$ELECTRON_APP" "$APP" 2>/dev/null || cp -R "$ELECTRON_APP" "$APP"; } || return 1
  command -v plutil >/dev/null 2>&1 && plutil -convert xml1 "$APP/Contents/Info.plist" || true
  node "$APP_DIR/scripts/alphacris-bundle.mjs" "$APP" "$APP_DIR" || return 1
  if [ "$(uname)" = "Darwin" ]; then
    xattr -cr "$APP" 2>/dev/null || true
    codesign --force --deep --sign - "$APP" || return 1
  fi
}

# Repli : petit lanceur en script (nom correct dans le Finder, mais le Dock peut afficher « Electron »).
make_stub() {
  rm -rf "$APP"
  mkdir -p "$APP/Contents/MacOS"
  cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>AlphaCris</string>
  <key>CFBundleDisplayName</key><string>AlphaCris</string>
  <key>CFBundleIdentifier</key><string>app.lycapps.alphacris.starter</string>
  <key>CFBundleExecutable</key><string>launch</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSUIElement</key><true/>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
</dict>
</plist>
PLIST
  cat > "$APP/Contents/MacOS/launch" <<LAUNCH
#!/bin/zsh -l
APP_DIR="$APP_DIR"
ELECTRON="\$APP_DIR/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
if [ ! -x "\$ELECTRON" ] || [ ! -f "\$APP_DIR/dist/main/main.js" ]; then
  osascript -e 'display dialog "AlphaCris est incomplet (dépendances ou compilation manquantes). Dans le Terminal : cd apps/launcher puis npm install && npm run build, puis relancez npm run app:install." buttons {"OK"} with icon caution'
  exit 1
fi
cd "\$APP_DIR"
exec "\$ELECTRON" "\$APP_DIR"
LAUNCH
  chmod +x "$APP/Contents/MacOS/launch"
}

if make_bundle; then
  echo "Créé : $APP"
else
  echo "Copie d'Electron impossible : installation du lanceur de secours." >&2
  make_stub
  echo "Créé (lanceur de secours) : $APP"
fi
echo "Si l'ancienne version tourne encore, quittez-la (⌘Q) avant d'ouvrir $NAME."
echo "Ouvrez-la : open \"$APP\". Pour le lancement à la connexion : Réglages Système → Général → Éléments de connexion → +"
