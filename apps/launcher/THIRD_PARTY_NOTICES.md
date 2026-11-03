# Notices tierces

## jarvis-assistant-vocal (inspiration)

Le dépôt https://github.com/sosoj92/jarvis-assistant-vocal est distribué sous licence MIT. La conversation vocale de
AlphaCris s'en inspire (détection de parole auto-calibrée, fenêtre d'écoute de suite, mots d'arrêt, filtre des
hallucinations de Whisper, réponses courtes lues phrase par phrase, confirmation orale stricte). Aucun fichier n'a été copié :
le code est une réécriture originale en TypeScript. La licence d'origine est reproduite ci-dessous par courtoisie.

    MIT License
    
    Copyright (c) 2026 sosoj92
    
    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:
    
    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.
    
    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.

## Composants utilisés à l'exécution (installés séparément, non redistribués)

- whisper.cpp (MIT) — https://github.com/ggml-org/whisper.cpp, installé par Homebrew (`brew install whisper-cpp`).
- Modèles Whisper au format ggml — poids publiés par OpenAI sous licence MIT, téléchargés depuis Hugging Face par `npm run voice:install`.
- `say` : synthèse vocale intégrée à macOS.
