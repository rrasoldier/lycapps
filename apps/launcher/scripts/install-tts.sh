#!/usr/bin/env bash
# Installe une voix neuronale de qualité, gratuite et 100 % locale pour les réponses parlées : Piper.
# Rien n'est envoyé sur Internet par la suite (seul le téléchargement initial en a besoin). `say` reste le repli.
#
# Piper (GPL-3.0) est installé À PART dans ~/.cursor-launcher/piper (environnement Python) et lancé comme un
# programme externe : il n'est pas intégré à l'application. La voix (.onnx) a sa propre licence : voir la
# « MODEL_CARD » affichée à la fin. La voix par défaut, siwis, est sous CC-BY 4.0 (attribution : Edinburgh
# DataShare, SIWIS database) et ne coûte rien.
#
# Usage : npm run tts:install                          -> voix française fr_FR-siwis-medium (~65 Mo)
#         npm run tts:install -- fr_FR-siwis-low       -> même voix, plus légère
#         npm run tts:install -- fr_FR-upmc-medium     -> autre voix (nom du catalogue rhasspy/piper-voices)
set -euo pipefail

VOICE="${1:-fr_FR-siwis-medium}"
if ! [[ "$VOICE" =~ ^([a-z]{2})_([A-Z]{2})-([a-z0-9_]+)-(x_low|low|medium|high)$ ]]; then
  echo "Nom de voix inconnu « $VOICE » (attendu : fr_FR-siwis-medium, fr_FR-upmc-medium…)." >&2
  exit 2
fi
LANG_CODE="${BASH_REMATCH[1]}"
LOCALE="${BASH_REMATCH[1]}_${BASH_REMATCH[2]}"
SPEAKER="${BASH_REMATCH[3]}"
QUALITY="${BASH_REMATCH[4]}"

ROOT="${LAUNCHER_HOME:-$HOME/.cursor-launcher}"
PIPER_DIR="$ROOT/piper"
VENV="$PIPER_DIR/venv"
VOICES="$ROOT/voices"
BASE="${PIPER_VOICE_BASE_URL:-https://huggingface.co/rhasspy/piper-voices/resolve/main}/$LANG_CODE/$LOCALE/$SPEAKER/$QUALITY"
PY="${PIPER_PYTHON:-python3}"

if ! command -v "$PY" >/dev/null 2>&1; then
  echo "Python 3 est absent. Installez-le : xcode-select --install (ou brew install python), puis relancez cette commande." >&2
  exit 1
fi
if ! "$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)'; then
  echo "Python 3.9 ou plus récent est nécessaire (trouvé : $("$PY" --version 2>&1)). Installez-le : brew install python" >&2
  exit 1
fi

mkdir -p "$PIPER_DIR" "$VOICES"
if [ -x "$VENV/bin/python3" ] && "$VENV/bin/python3" -c 'import piper' >/dev/null 2>&1; then
  echo "Piper : déjà installé."
else
  echo "Installation de Piper dans $VENV (une seule fois)…"
  "$PY" -m venv "$VENV"
  "$VENV/bin/python3" -m pip install --quiet --upgrade pip
  "$VENV/bin/python3" -m pip install --quiet "piper-tts>=1.3"
fi

MODEL="$VOICES/$VOICE.onnx"
for ext in onnx onnx.json; do
  f="$VOICES/$VOICE.$ext"
  if [ -s "$f" ]; then
    echo "Déjà présent : $f"
  else
    echo "Téléchargement de $VOICE.$ext (une seule fois)…"
    curl -L --fail --progress-bar -o "$f.part" "$BASE/$VOICE.$ext"
    mv "$f.part" "$f"
  fi
done

echo "Essai de la voix…"
WAV="$(mktemp "${TMPDIR:-/tmp}/alphacris-tts.XXXXXX")"
trap 'rm -f "$WAV"' EXIT
printf '%s\n' "Bonjour, je suis AlphaCris. Voici ma nouvelle voix." | "$VENV/bin/python3" -m piper -m "$MODEL" -f "$WAV" >/dev/null 2>&1
if [ ! -s "$WAV" ]; then
  echo "La synthèse de test a échoué : relancez avec « $VENV/bin/python3 -m piper --help » pour diagnostiquer." >&2
  exit 1
fi
if [ "$(uname)" = "Darwin" ] && command -v afplay >/dev/null 2>&1 && [ -z "${TTS_NO_PLAY:-}" ]; then
  afplay "$WAV" || true
fi

echo
echo "Terminé : voix $VOICE installée dans $VOICES."
echo "Licence de la voix : $BASE/MODEL_CARD"
echo "Relancez AlphaCris : Réglages → Voix → « Moteur de voix » reste sur Automatique et utilisera Piper."
