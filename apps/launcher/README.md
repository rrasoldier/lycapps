# Cursor Launcher (MVP)

Lanceur global pour Mac, façon Alfred / Raycast, qui donne accès à un agent IA capable d'agir sur l'ordinateur (fichiers, shell, applications) depuis une simple barre de prompt, sans ouvrir l'interface complète de Cursor.

- **Raccourci global** (défaut `Option+Espace`) : affiche/masque une fenêtre flottante sans bordure, centrée en haut de l'écran, façon Spotlight.
- **Application de barre de menus** : pas d'icône dans le Dock, lancement au démarrage optionnel.
- **Interface de conversation** : fil de discussion avec bulles, réponses formatées en Markdown (titres, listes, tableaux, code, liens), étapes de l'agent visibles, confirmations intégrées au fil, mémoire de la conversation. L'agent peut vous **poser des questions** (`ask_user`) auxquelles on répond **par boutons ou par texte**.
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
- Une clé **Cursor** (recommandé, voir [Utiliser sa clé Cursor](#utiliser-sa-clé-cursor)), ou une clé d'un fournisseur compatible OpenAI avec appel d'outils (OpenAI, Anthropic via son endpoint compatible, OpenRouter), ou un modèle local Ollama.
- Electron 38 est embarqué (Node 22.22) : requis par le SDK Cursor (Node ≥ 22.13).

## Installation et lancement

```bash
cd apps/launcher
npm install
npm run build
npm start            # build + lance l'app (pas de Dock : cherchez l'icône 🔍 dans la barre de menus)
```

Premier lancement : appuyez sur `Option+Espace`, ouvrez les réglages (⚙) et renseignez le fournisseur / modèle / clé.

Options de ligne de commande : `--show` affiche la fenêtre au démarrage (pratique en développement).

### Lancer sans Terminal, et mises à jour

```bash
npm run app:install   # crée ~/Applications/Cursor Launcher.app (à faire une seule fois)
```

Ensuite : double-clic sur **Cursor Launcher** (Finder, Launchpad, Spotlight), ou glisser l'app dans le Dock. Pour qu'elle démarre à la connexion : Réglages Système → Général → Éléments de connexion → `+`. Cette petite app lance simplement l'application depuis le dossier du dépôt (le chemin est mémorisé : si vous déplacez le dossier, relancez `npm run app:install`).

**Mises à jour** (depuis le dépôt git, sans `.dmg` ni signature Apple) :
- Au démarrage (réglage « Mises à jour auto », activé par défaut) : `git fetch`, puis si des nouveautés existent `git pull --ff-only`, `npm install` seulement si `package.json`/`package-lock.json` ont changé, `npm run build`, et l'app redémarre toute seule. Décochable dans le menu de la barre de menus ou les réglages.
- À la demande : icône de la barre de menus → **Mettre à jour (N nouveautés)…** (ou **Vérifier les mises à jour**), ou ⚙ → « Version » → bouton. Une vérification est aussi faite toutes les 6 h ; une notification signale une nouveauté disponible (appliquée seulement au démarrage ou sur clic).
- Garde-fous : jamais de `reset --hard`/force ; si vous avez des modifications locales en conflit, `git pull` échoue et rien n'est écrasé ; si la compilation échoue, retour à la version précédente (`git reset --keep`) et message d'erreur.
- La branche locale doit suivre une branche distante (c'est le cas après un `git clone` ou `git pull origin <branche>`). Si la branche de la PR est supprimée après fusion, faire `git checkout main && git pull` puis `npm run build` une fois.
- Les mises à jour s'exécutent via un shell de connexion (`/bin/zsh -l`) pour retrouver `git` et `npm` (Homebrew, nvm…).
- Un `.dmg` installé (sans dépôt git) n'a pas ce mécanisme : le menu indique « indisponible ». Une mise à jour automatique d'un `.dmg` (electron-updater + GitHub Releases) exige une app **signée** par un compte Apple Developer payant, ce qui n'est pas en place.

Attention : une app lancée depuis le Finder ne voit pas les variables définies dans `~/.zshrc` (ex. `CURSOR_API_KEY`). Saisissez la clé dans ⚙ → Clé API (stockée dans le Trousseau), ou exportez-la dans `~/.zprofile`.

**Icône 🔍 introuvable dans la barre de menus** (l'app tourne pourtant : `Option+Espace` fonctionne) :
1. Réglages Système → **Barre des menus** → section « Autoriser dans la barre des menus » : activer **Electron** / **Cursor Launcher** (macOS 13+ peut masquer une app dont l'identité a changé, par ex. après être passé de `npm start` à `Cursor Launcher.app`).
2. Barre de menus saturée (surtout avec l'encoche) : fermer/retirer d'autres icônes (⌘ + glisser hors de la barre) ou réduire leur nombre.
3. Rouvrir l'app (double-clic sur `Cursor Launcher.app`) affiche aussi la fenêtre, d'où l'on peut ouvrir ⚙ ; le menu « Quitter » n'est accessible que par l'icône : sinon, Moniteur d'activité → Electron → Quitter.

### Clés API

Jamais dans le code ni dans `settings.json`. Ordre de résolution :

1. Variable d'environnement : `CURSOR_API_KEY` (fournisseur Cursor), ou `LAUNCHER_API_KEY` puis celle du fournisseur (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`) pour les autres. `LAUNCHER_API_KEY` n'est **jamais** utilisée pour Cursor, pour ne pas envoyer par erreur la clé d'un autre fournisseur à Cursor.
2. Trousseau : saisie dans les réglages, chiffrée avec `safeStorage` d'Electron (clé stockée dans le Trousseau macOS). Une entrée **par fournisseur** : changer de fournisseur n'envoie jamais la clé de l'un à l'autre.

Une app lancée depuis le Finder **n'hérite pas** des variables de votre shell. Soit utiliser les réglages (recommandé), soit `launchctl setenv OPENAI_API_KEY sk-...` puis relancer l'app, soit lancer depuis un terminal : `OPENAI_API_KEY=... npm start`.

Dictée (Cursor n'offre pas de transcription : il faut une clé compatible Whisper, par ex. OpenAI, même si l'agent utilise Cursor) : `LAUNCHER_TRANSCRIPTION_API_KEY`, sinon `OPENAI_API_KEY`, sinon clé saisie dans les réglages, sinon la clé du fournisseur si c'est OpenAI. Le modèle (`whisper-1`) et l'URL se règlent dans `settings.json` (`transcriptionModel`, `transcriptionBaseUrl`).

### Réglages

Stockés dans `~/Library/Application Support/Cursor Launcher/settings.json` (permissions `600`) : raccourcis (format [accélérateur Electron](https://www.electronjs.org/docs/latest/api/accelerator), ex. `CommandOrControl+Shift+Space`), fournisseur / URL / modèle, dossiers autorisés, dossier des projets, lancement au login. L'historique des prompts est dans `history.json` (100 entrées max, effaçable depuis les réglages). Navigation : `↑` / `↓` dans la barre de prompt.

## Utiliser sa clé Cursor

Recherche faite dans la documentation officielle ([vue d'ensemble des API](https://cursor.com/docs/api), [SDK TypeScript](https://cursor.com/docs/sdk/typescript)) :

- Cursor **ne documente pas d'API de modèles / chat-completions** utilisable avec une clé Cursor (« The Cursor SDK is an agent SDK, not a standalone model-inference or chat-completions API »). On ne peut donc pas brancher la clé Cursor sur le client OpenAI-compatible.
- Ce qui existe : le **SDK officiel `@cursor/sdk`** (public beta, tous les utilisateurs), avec un runtime **local** : la boucle d'agent tourne dans notre processus, l'inférence reste hébergée par Cursor (donc tous les modèles de votre compte, dont Claude). Clé : *user API key* (cursor.com/dashboard/cloud-agents ou Dashboard → API Keys) ou clé de compte de service. La consommation suit votre forfait Cursor (étiquette « SDK » dans le tableau d'usage), sans clé Anthropic.
- Les **Cloud Agents** (VM Cursor + dépôt Git) ne conviennent pas : ils n'agissent pas sur votre Mac.

Intégration dans le lanceur (fournisseur **« Cursor »**, choisi par défaut) :

1. Définir `CURSOR_API_KEY` (ou la saisir dans ⚙ → Clé API, stockée dans le trousseau).
2. ⚙ → Modèle : défaut `composer-2.5` ; « Lister les modèles » interroge `Cursor.models.list()` (catalogue de **votre** compte/équipe, où choisir un modèle Claude).
3. Les outils intégrés du SDK (shell, édition…) sont **désactivés** (`tools: ["mcp"]`). On lui expose uniquement **nos** outils via `local.customTools` : ils passent par le même périmètre de dossiers et les mêmes confirmations que pour les autres fournisseurs. Le mode dossier utilise un agent « texte seul » (`tools: []`) pour proposer le plan, validé ensuite par notre code.

Limites propres à Cursor :
- Le SDK est un agent complet, pas un simple modèle : la conversation réutilise le même agent Cursor (mémoire jusqu'à « Nouvelle conversation » ou changement de clé/modèle ; une erreur du SDK le referme), pas de streaming dans l'UI (résultat à la fin), latence supérieure à un appel direct. Avec Cursor, le texte intermédiaire et la « réflexion » sont relayés dans la ligne de progression via `run.stream()` (non vérifié avec une vraie clé ; en cas d'échec du flux, seul le résultat final s'affiche). Le prompt système Cursor reste en place (orienté code) ; nos consignes sont ajoutées au message (`systemPrompt` personnalisé = option réservée aux comptes autorisés).
- Licence : `@cursor/sdk` est propriétaire (« Anysphere, soumis aux conditions d'utilisation de Cursor ») ; vérifier que la redistribution dans un `.dmg` vous convient.
- Compatibilité avec un compte réel : le chargement du SDK dans Electron 38 et l'acceptation de nos options (`tools`, `customTools`) sont vérifiés (rejet « Invalid User API Key » par Cursor avec une fausse clé), mais **aucun appel complet n'a pu être testé sans clé valide** : voir la liste « À vérifier ».
- Packaging : le SDK embarque des binaires par plateforme (`@cursor/sdk-darwin-arm64`, `-x64`) ; `asarUnpack` est configuré, mais construire séparément chaque architecture (ou installer les deux paquets) et vérifier l'app signée.

## Utilisation

| Action | Comment |
| --- | --- |
| Afficher / masquer | `Option+Espace` (ou clic sur l'icône de barre de menus). `Échap` : annuler / fermer (la conversation est conservée quand la fenêtre est masquée). |
| Instruction à l'agent | Taper puis `Entrée` (`Maj+Entrée` = saut de ligne, `↑`/`↓` = historique). La fenêtre s'agrandit en conversation ; `⌘N` ou « Nouvelle conversation » repart de zéro. Ex. « Crée une petite app web de to-do list dans mon dossier Projects », « Quels sont les 5 plus gros fichiers de Downloads ? » |
| Ranger un dossier | Glisser le dossier sur la fenêtre (ou 📁), taper la consigne (« range par année puis par type ») puis `Entrée` pour l'aperçu. `⌘Entrée` = rangement par type **sans IA**. |
| Répondre à l'agent | Quand l'agent a besoin d'une précision, une carte apparaît dans le fil : cliquer un bouton (ou touche `1`–`9` quand le champ est vide) ou écrire sa réponse dans la barre de prompt. `Échap` refuse de répondre et interrompt la demande. |
| Suivre l'avancement | Pendant une demande : barre animée, temps écoulé, nombre d'actions et étape en cours (« Lit … », « Exécute : … », « ⏸ En attente de votre confirmation »). Le pourcentage réel n'est pas connaissable (nombre d'étapes inconnu) : la barre est donc indéterminée. `Échap` annule. |
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
  cursor.ts        Fournisseur Cursor : SDK officiel (runtime local) + nos outils en customTools
  organizer.ts     Mode dossier : scan, plan (par type / via LLM), validation, application, annulation
  service.ts       Orchestration (clés, plans en attente, autorisation de dossier, transcription)
  settings.ts      Réglages et historique (JSON)
  transcribe.ts    Whisper (multipart /audio/transcriptions)
src/main/        Processus principal Electron : fenêtre, tray, raccourcis, IPC, trousseau (safeStorage)
src/preload/     Pont contextBridge minimal (API typée, pas d'accès Node)
src/renderer/    UI (HTML/CSS/TS sans framework) : barre de prompt, aperçu de plan, confirmations, réglages, micro
test/            Tests Vitest (73 tests)
scripts/         copy-assets, gen-icons (icône tray), e2e-smoke (Linux/Xvfb)
```

Le renderer ne touche jamais au disque : tout passe par l'IPC vers le processus principal, qui applique périmètre et confirmations. Les confirmations sont demandées au renderer (`confirm:request`) et bloquent l'outil jusqu'à la réponse ; masquer la fenêtre vaut refus.

## Tests

```bash
npm test             # 90 tests unitaires/intégration (Vitest)
npm run typecheck
npm run build
npm run e2e:linux    # app Electron réelle sous Xvfb + faux serveur LLM (nécessite xvfb-run)
```

Couverture : périmètre (traversée, liens symboliques, préfixes voisins), classification shell, chaque outil (confirmation, refus, non-écrasement, timeout shell), boucle agent (erreurs d'outils, limite d'étapes, annulation), client LLM, mode dossier (dry-run, sélection partielle, collisions, re-vérification, annulation, autorisation hors périmètre), stockage des réglages/historique, transcription, résolution des clés, mémoire de conversation, outil `ask_user`, analyseur Markdown, mise à jour git (nouveautés, `npm install` conditionnel, échec de compilation avec retour arrière, modifications locales, dépôt injoignable, sur de vrais dépôts temporaires). Le test e2e Linux couvre aussi le fil de conversation, les boutons de réponse, le rendu Markdown et « Nouvelle conversation ».

## À vérifier sur Mac

Non testable depuis la VM Linux :

- [ ] `Option+Espace` : raccourci global, éventuel conflit avec Spotlight/Alfred/clavier (changer dans les réglages), affichage au-dessus des apps en plein écran et sur tous les Spaces.
- [ ] Pas d'icône Dock (`setActivationPolicy('accessory')` + `LSUIElement` dans le `.dmg`), icône « template » correcte en mode clair/sombre, menu de la barre de menus.
- [ ] Prise de focus de la fenêtre depuis une autre app, masquage à la perte de focus, restitution du focus à l'app précédente (`app.hide()`).
- [ ] Lancement au login (`setLoginItemSettings`, visible dans Réglages Système → Général → Éléments de connexion).
- [ ] **Fournisseur Cursor** avec une vraie clé : un prompt avec appel d'outil (ex. « liste mon dossier Downloads »), confirmation affichée pour un shell, annulation (Échap), « Lister les modèles » et sélection d'un modèle Claude, mode dossier. Vérifier aussi que le modèle appelle bien nos outils `custom-user-tools` (et qu'aucun outil intégré Cursor n'est proposé), le chargement du SDK dans l'app packagée (`asarUnpack`, binaire darwin) et l'usage « SDK » dans le tableau de bord Cursor.
- [ ] Dictée : invite micro, `MediaRecorder` WebM/Opus dans Electron macOS, qualité Whisper en français, raccourci `Option+Maj+Espace`. Limite connue : `globalShortcut` ne détecte pas le relâchement d'une touche, donc le raccourci global **bascule** (démarrer/arrêter) ; le vrai push-to-talk (maintien) n'existe que sur le bouton micro.
- [ ] `open -a` pour « ouvrir une app », Corbeille (`shell.trashItem`), invites d'accès aux dossiers Bureau/Documents/Téléchargements.
- [ ] Trousseau : `safeStorage` (invite d'accès au Trousseau à la première utilisation, clé conservée entre deux lancements).
- [ ] Conversation : mise en page (fenêtre 780×680), saisie multi-lignes avec dictée, cartes de question (boutons + saisie libre) et de confirmation avec une vraie clé Cursor : vérifier que le modèle appelle bien `ask_user` quand il manque une information, et que la mémoire de l'agent Cursor est conservée d'un message à l'autre.
- [ ] `npm run app:install` : l'app « Cursor Launcher.app » se lance au double-clic (script shell comme exécutable, pas d'icône Dock en plus de celle d'Electron qui doit disparaître), au login, et le menu « Mettre à jour » fonctionne depuis cette app (PATH du shell de connexion, `git pull`, `npm install`, redémarrage automatique). Testé sur Linux avec un vrai dépôt distant : pull, compilation et relance automatique OK.
- [ ] Drag & drop d'un dossier depuis le Finder (`webUtils.getPathForFile`).
- [ ] `npm run dist` : génération du `.dmg` arm64/x64, signature/notarisation.

## Limites et pistes

- Un seul fournisseur à la fois (Cursor, ou OpenAI-compatible) ; pas de streaming des réponses mot à mot (réponse affichée en fin d'étape).
- Mémoire de conversation limitée aux 60 derniers messages (fournisseurs OpenAI-compatibles) et non conservée après redémarrage de l'app.
- Le rendu Markdown est volontairement minimal (pas d'images, pas de HTML, liens `http(s)`/`mailto` seulement).
- Mode dossier non récursif ; l'annulation ne couvre que le dernier rangement de la session.
- Pas de pilotage d'UI (clics, saisie) ni de lecture d'écran : prévu après validation du MVP.
- Dictée uniquement via API Whisper (la Web Speech API de Chromium n'est pas fonctionnelle dans Electron sans clés Google). Pistes : `whisper.cpp` local, dictée macOS native.
- Pas de tests automatisés de l'UI macOS native ni de CI dédiée.
