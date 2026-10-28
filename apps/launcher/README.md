# Cursor Launcher (MVP)

Lanceur global pour Mac, façon Alfred / Raycast, qui donne accès à un agent IA capable d'agir sur l'ordinateur (fichiers, shell, applications) depuis une simple barre de prompt, sans ouvrir l'interface complète de Cursor.

- **Raccourci global** (défaut `Option+Espace`) : affiche/masque une fenêtre flottante sans bordure, centrée en haut de l'écran, façon Spotlight.
- **Application de barre de menus** : pas d'icône dans le Dock, lancement au démarrage optionnel.
- **Agent** avec outils : lister / lire / écrire / déplacer des fichiers, Corbeille, commande shell, ouvrir une app ou une URL, créer un projet.
- **Mode dossier** : glisser-déposer (ou 📁) un dossier + une consigne → aperçu du plan → confirmation → application → annulation possible.
- **Voix** : bouton micro (clic = bascule, maintien = push-to-talk) et raccourci global de dictée (défaut `Option+Maj+Espace`). Transcription via Whisper (API compatible OpenAI).
- **Sécurité** : périmètre de dossiers autorisés, confirmation pour tout shell / déplacement / écrasement / suppression, aucune clé en dur.

> Statut : MVP développé et testé sur Linux (logique + application Electron sous Xvfb). Le rendu et les intégrations macOS natives (raccourci global, Dock, tray, micro, `.dmg`) sont à valider sur un vrai Mac — voir [« À vérifier sur Mac »](#à-vérifier-sur-mac).

## Pourquoi Electron

| Critère | Electron + TypeScript | Tauri |
| --- | --- | --- |
| Fenêtre flottante sans bordure, tray, raccourci global, `LSUIElement` | Natif, API stables | Possible (plugins), plus de plomberie |
| Micro / `MediaRecorder` / drag & drop de dossier | Chromium embarqué, comportement identique partout | Dépend de WKWebView (permissions micro plus capricieuses) |
| Même langage que le reste du dépôt (TypeScript) et réutilisation du code agent | Oui, un seul runtime Node | Backend Rust à écrire |
| Poids | ~100 Mo | ~10 Mo |

Pour un MVP à itérer vite, Electron est le choix le plus pragmatique ; le cœur (`src/core`) ne dépend pas d'Electron et pourrait être réutilisé tel quel avec un autre shell.

## Prérequis

- macOS 12+ (Apple Silicon ou Intel), Node.js 20+ et npm.
- Une clé API d'un fournisseur de LLM compatible OpenAI avec appel d'outils (OpenAI, Anthropic via son endpoint compatible, OpenRouter) ou un modèle local Ollama.

## Installation et lancement

```bash
cd apps/launcher
npm install
npm run build
npm start            # build + lance l'app (pas de Dock : cherchez l'icône 🔍 dans la barre de menus)
```

Premier lancement : appuyez sur `Option+Espace`, ouvrez les réglages (⚙) et renseignez le fournisseur / modèle / clé.

Options de ligne de commande : `--show` affiche la fenêtre au démarrage (pratique en développement).

### Clés API

Jamais dans le code ni dans `settings.json`. Ordre de résolution :

1. Variable d'environnement : `LAUNCHER_API_KEY`, sinon celle du fournisseur (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`).
2. Trousseau : saisie dans les réglages, chiffrée avec `safeStorage` d'Electron (clé stockée dans le Trousseau macOS).

Une app lancée depuis le Finder **n'hérite pas** des variables de votre shell. Soit utiliser les réglages (recommandé), soit `launchctl setenv OPENAI_API_KEY sk-...` puis relancer l'app, soit lancer depuis un terminal : `OPENAI_API_KEY=... npm start`.

Dictée : `LAUNCHER_TRANSCRIPTION_API_KEY`, sinon `OPENAI_API_KEY`, sinon clé saisie dans les réglages, sinon la clé du fournisseur si c'est OpenAI. Le modèle (`whisper-1`) et l'URL se règlent dans `settings.json` (`transcriptionModel`, `transcriptionBaseUrl`).

### Réglages

Stockés dans `~/Library/Application Support/Cursor Launcher/settings.json` (permissions `600`) : raccourcis (format [accélérateur Electron](https://www.electronjs.org/docs/latest/api/accelerator), ex. `CommandOrControl+Shift+Space`), fournisseur / URL / modèle, dossiers autorisés, dossier des projets, lancement au login. L'historique des prompts est dans `history.json` (100 entrées max, effaçable depuis les réglages). Navigation : `↑` / `↓` dans la barre de prompt.

## Utilisation

| Action | Comment |
| --- | --- |
| Afficher / masquer | `Option+Espace` (ou clic sur l'icône de barre de menus). `Échap` : annuler / fermer. |
| Instruction à l'agent | Taper puis `Entrée`. Ex. « Crée une petite app web de to-do list dans mon dossier Projects », « Quels sont les 5 plus gros fichiers de Downloads ? » |
| Ranger un dossier | Glisser le dossier sur la fenêtre (ou 📁), taper la consigne (« range par année puis par type ») puis `Entrée` pour l'aperçu. `⌘Entrée` = rangement par type **sans IA**. |
| Dicter | Cliquer 🎙 (re-cliquer ou `Échap` pour terminer), ou maintenir le bouton (push-to-talk), ou `Option+Maj+Espace` depuis n'importe où. Le texte transcrit est ajouté à la barre de prompt, à relire avant `Entrée`. |

### Mode dossier

1. **Aperçu (dry-run, par défaut)** : le plan liste chaque déplacement `source → destination`, que l'on peut décocher. Rien n'est modifié.
2. **Appliquer…** ouvre une confirmation explicite.
3. L'application revérifie chaque déplacement : pas d'écrasement, pas de sortie du dossier, pas de lien symbolique vers l'extérieur.
4. **Annuler ce rangement** remet les fichiers en place (et retire les sous-dossiers devenus vides).

Portée : fichiers du premier niveau (hors fichiers cachés et sous-dossiers), 500 fichiers max. Le plan « IA » n'envoie au fournisseur que les **noms, tailles et dates** — jamais le contenu. Aucune suppression ni renommage.

## Modèle de sécurité

- **Périmètre** : toutes les opérations fichiers passent par `Scope` (`src/core/security.ts`) : chemins canonisés avec résolution des liens symboliques, refus de `..`, de la racine du disque et des dossiers au préfixe voisin. Défaut : `~/Desktop`, `~/Documents`, `~/Downloads`, `~/Projects`. Un dossier déposé hors périmètre déclenche une demande d'autorisation explicite.
- **Confirmations** (fenêtre dans l'UI, bloquantes) : toute commande shell (niveau « danger » en rouge pour `rm -r`, `sudo`, `curl | sh`, etc.), tout déplacement, écrasement de fichier, Corbeille (toujours « danger », réversible via la Corbeille), création de projet, application d'un plan de rangement.
- **Pas de suppression directe** : l'agent n'a que `trash_file` (Corbeille). Aucun outil n'écrase une destination existante en déplacement.
- **Limites assumées** : une commande shell approuvée s'exécute avec vos droits et **n'est pas confinée** au périmètre (seul le dossier de départ l'est). C'est la confirmation qui protège : lisez la commande avant d'autoriser. Les cibles `open_url` sont limitées à `http`, `https`, `mailto`.
- **Fenêtre Electron** : `contextIsolation`, `sandbox`, pas de `nodeIntegration`, CSP stricte, navigation et ouverture de fenêtres bloquées.
- **Vie privée** : les prompts, résultats d'outils (contenu des fichiers lus, sortie shell) sont envoyés au fournisseur LLM choisi. Utilisez Ollama pour rester 100 % local.

## Permissions macOS

L'app n'est pas sandboxée (nécessaire pour piloter fichiers et shell). Selon l'usage, macOS demandera :

| Permission | Quand | Où l'accorder |
| --- | --- | --- |
| **Micro** | Première dictée (`NSMicrophoneUsageDescription`) | Réglages Système → Confidentialité et sécurité → Micro |
| **Accès aux fichiers** (Bureau, Documents, Téléchargements, volumes externes) | Première lecture/écriture dans ces dossiers | Invite automatique, ou Confidentialité → Fichiers et dossiers |
| **Accès complet au disque** | Si l'agent doit lire des dossiers protégés (Mail, Messages, Safari…) ou si les invites ci-dessus ne suffisent pas | Confidentialité → Accès complet au disque → ajouter Cursor Launcher |
| **Accessibilité** | Pas requis par le MVP. Les raccourcis globaux utilisent `globalShortcut` (Carbon `RegisterEventHotKey`) qui n'exige pas cette permission. Nécessaire seulement si l'on ajoute plus tard du pilotage d'UI (AppleScript « System Events », saisie simulée) | Confidentialité → Accessibilité |
| **Automatisation** | Si l'agent pilote d'autres apps via `osascript` (invite par app cible) | Confidentialité → Automatisation |

En développement (`npm start`), c'est l'application **Electron** (ou votre Terminal) qui apparaît dans ces listes, pas « Cursor Launcher ».

## Packaging `.dmg`

```bash
cd apps/launcher
npm run dist         # build + electron-builder --mac dmg  → release/*.dmg (arm64 + x64)
```

La configuration est dans `package.json` (`build`) : `LSUIElement` (pas de Dock), textes d'usage du micro et des dossiers, `hardenedRuntime`, entitlements (`build/entitlements.mac.plist` : micro, Apple Events, JIT pour V8). Sans certificat Apple Developer, l'app n'est pas signée : au premier lancement, clic droit → Ouvrir (ou `xattr -dr com.apple.quarantine "/Applications/Cursor Launcher.app"`). Pour distribuer proprement : variables `CSC_LINK` / `CSC_KEY_PASSWORD` (signature) et `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` (notarisation). Aucune icône d'application n'est fournie (icône Electron par défaut) : ajouter `build/icon.icns`.

## Architecture

```
src/core/        Logique pure, sans Electron (testée)
  security.ts      Scope (périmètre, liens symboliques), classification des commandes shell, URL/app sûres
  tools.ts         Outils de l'agent + politique de confirmation
  agent.ts         Boucle LLM ↔ outils (12 étapes max, annulable)
  llm.ts           Client « chat completions » compatible OpenAI + presets de fournisseurs
  organizer.ts     Mode dossier : scan, plan (par type / via LLM), validation, application, annulation
  service.ts       Orchestration (clés, plans en attente, autorisation de dossier, transcription)
  settings.ts      Réglages et historique (JSON)
  transcribe.ts    Whisper (multipart /audio/transcriptions)
src/main/        Processus principal Electron : fenêtre, tray, raccourcis, IPC, trousseau (safeStorage)
src/preload/     Pont contextBridge minimal (API typée, pas d'accès Node)
src/renderer/    UI (HTML/CSS/TS sans framework) : barre de prompt, aperçu de plan, confirmations, réglages, micro
test/            Tests Vitest (58 tests)
scripts/         copy-assets, gen-icons (icône tray), e2e-smoke (Linux/Xvfb)
```

Le renderer ne touche jamais au disque : tout passe par l'IPC vers le processus principal, qui applique périmètre et confirmations. Les confirmations sont demandées au renderer (`confirm:request`) et bloquent l'outil jusqu'à la réponse ; masquer la fenêtre vaut refus.

## Tests

```bash
npm test             # 58 tests unitaires/intégration (Vitest)
npm run typecheck
npm run build
npm run e2e:linux    # app Electron réelle sous Xvfb + faux serveur LLM (nécessite xvfb-run)
```

Couverture : périmètre (traversée, liens symboliques, préfixes voisins), classification shell, chaque outil (confirmation, refus, non-écrasement, timeout shell), boucle agent (erreurs d'outils, limite d'étapes, annulation), client LLM, mode dossier (dry-run, sélection partielle, collisions, re-vérification, annulation, autorisation hors périmètre), stockage des réglages/historique, transcription, résolution des clés.

## À vérifier sur Mac

Non testable depuis la VM Linux :

- [ ] `Option+Espace` : raccourci global, éventuel conflit avec Spotlight/Alfred/clavier (changer dans les réglages), affichage au-dessus des apps en plein écran et sur tous les Spaces.
- [ ] Pas d'icône Dock (`setActivationPolicy('accessory')` + `LSUIElement` dans le `.dmg`), icône « template » correcte en mode clair/sombre, menu de la barre de menus.
- [ ] Prise de focus de la fenêtre depuis une autre app, masquage à la perte de focus, restitution du focus à l'app précédente (`app.hide()`).
- [ ] Lancement au login (`setLoginItemSettings`, visible dans Réglages Système → Général → Éléments de connexion).
- [ ] Dictée : invite micro, `MediaRecorder` WebM/Opus dans Electron macOS, qualité Whisper en français, raccourci `Option+Maj+Espace`. Limite connue : `globalShortcut` ne détecte pas le relâchement d'une touche, donc le raccourci global **bascule** (démarrer/arrêter) ; le vrai push-to-talk (maintien) n'existe que sur le bouton micro.
- [ ] `open -a` pour « ouvrir une app », Corbeille (`shell.trashItem`), invites d'accès aux dossiers Bureau/Documents/Téléchargements.
- [ ] Trousseau : `safeStorage` (invite d'accès au Trousseau à la première utilisation, clé conservée entre deux lancements).
- [ ] Drag & drop d'un dossier depuis le Finder (`webUtils.getPathForFile`).
- [ ] `npm run dist` : génération du `.dmg` arm64/x64, signature/notarisation.

## Limites et pistes

- Un seul fournisseur « style OpenAI » à la fois ; pas de streaming des réponses (résultat affiché en fin d'étape).
- Pas de mémoire de conversation entre deux prompts (l'historique ne rejoue que le texte des prompts).
- Mode dossier non récursif ; l'annulation ne couvre que le dernier rangement de la session.
- Pas de pilotage d'UI (clics, saisie) ni de lecture d'écran : prévu après validation du MVP.
- Dictée uniquement via API Whisper (la Web Speech API de Chromium n'est pas fonctionnelle dans Electron sans clés Google). Pistes : `whisper.cpp` local, dictée macOS native.
- Pas de tests automatisés de l'UI macOS native ni de CI dédiée.
