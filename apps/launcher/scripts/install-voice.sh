#!/usr/bin/env bash
# Installe la dictée locale et gratuite : whisper.cpp (Homebrew) + un modèle de reconnaissance vocale.
# Rien n'est envoyé sur Internet par la suite : le micro est transcrit sur votre Mac.
#
# Usage : npm run voice:install            -> modèle « small » (~470 Mo, bon en français)
#         npm run voice:install -- base    -> modèle « base » (~150 Mo, plus rapide, moins précis)
#         npm run voice:install -- medium  -> modèle « medium » (~1,5 Go, plus précis, plus lent)
set -euo pipefail

MODEL="${1:-small}"
case "$MODEL" in
  base|small|medium) ;;
  *) echo "Modèle inconnu « $MODEL » (base, small ou medium)." >&2; exit 2 ;;
esac

DIR="$HOME/.cursor-launcher/models"
FILE="$DIR/ggml-$MODEL.bin"
URL="${WHISPER_MODEL_URL:-https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-$MODEL.bin}"

if ! command -v whisper-cli >/dev/null 2>&1 && [ ! -x /opt/homebrew/bin/whisper-cli ] && [ ! -x /usr/local/bin/whisper-cli ]; then
  if command -v brew >/dev/null 2>&1; then
    echo "Installation de whisper.cpp (brew install whisper-cpp)…"
    brew install whisper-cpp
  else
    echo "Homebrew est absent : installez-le depuis https://brew.sh puis relancez cette commande." >&2
    exit 1
  fi
else
  echo "whisper-cli : déjà installé."
fi

mkdir -p "$DIR"
if [ -s "$FILE" ]; then
  echo "Modèle déjà présent : $FILE"
else
  echo "Téléchargement du modèle $MODEL dans $DIR (une seule fois)…"
  curl -L --fail --progress-bar -o "$FILE.part" "$URL"
  mv "$FILE.part" "$FILE"
fi

if [ "$(uname)" = "Darwin" ] && command -v say >/dev/null 2>&1; then
  echo
  echo "Voix françaises disponibles pour la synthèse (réglages → Voix) :"
  say -v '?' | grep -E '\bfr_' || echo "  aucune : Réglages Système → Accessibilité → Contenu énoncé → Voix du système → Gérer les voix."
fi

echo
echo "Terminé. Relancez l'application, puis cliquez sur le micro."
