# AlphaCris (MVP)

Lanceur global pour Mac, façon Alfred / Raycast, qui donne accès à un agent IA capable d'agir sur l'ordinateur (fichiers, shell, applications) depuis une simple barre de prompt, sans ouvrir l'interface complète de Cursor.

- **Raccourci global** (défaut `Option+Espace`) : affiche/masque une fenêtre flottante sans bordure, centrée en haut de l'écran, façon Spotlight.
- **Application de barre de menus** : item « AlphaCris » dans la barre de menus, pas d'icône dans le Dock par défaut, lancement au démarrage optionnel.
- **Interface de conversation** : fil de discussion avec bulles, réponses formatées en Markdown (titres, listes, tableaux, code, liens), étapes de l'agent visibles, confirmations intégrées au fil, mémoire de la conversation. L'agent peut vous **poser des questions** (`ask_user`) auxquelles on répond **par boutons ou par texte**.
- **Agent** avec outils : lister / lire / écrire / déplacer des fichiers, Corbeille, commande shell, ouvrir une app ou une URL, créer un projet.
- **Mode dossier** : glisser-déposer (ou 📁) un dossier + une consigne → aperçu du plan → confirmation → application → annulation possible.
- **Voix** : conversation parlée (écoute → transcription → agent → réponse lue → suite sans relancer), 100 % gratuite et locale possible (Whisper local + voix du Mac), mot d'activation optionnel, confirmations « oui / non » à l'oral. Voir [« Conversation vocale »](#conversation-vocale).
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
npm start            # build + lance l'app (pas de Dock par défaut : icône « AlphaCris » dans la barre de menus ; sinon voir le dépannage ci-dessous)
npm run dev          # développement : recompile en continu, l'interface se recharge à chaque modification (voir ci-dessous)
```

Premier lancement : appuyez sur `Option+Espace`, ouvrez les réglages (⚙) et renseignez le fournisseur / modèle / clé.

Options de ligne de commande : `--show` affiche la fenêtre au démarrage (pratique en développement) ; `--dev` surveille le renderer (voir `npm run dev`) ; `--reloaded` (ajouté par « Recharger ») évite de redire bonjour après un redémarrage.

### Itérer vite : « Recharger » et mode développement

**Sur le Mac, depuis `AlphaCris.app` (un clic, aucune commande)** : bouton **Recharger** (en haut de la fenêtre), menu de la barre de menus → **Recharger (dernière version, recompile et relance)**, ou `⇧⌘R`. L'app fait `git pull --ff-only` (dernier commit de la branche suivie), `npm install` seulement si `package.json` a changé, `npm run build` (**toujours**, même sans nouveau commit : les modifications faites sur place, par exemple dans Cursor sur ce Mac, sont donc prises en compte), puis se relance toute seule, fenêtre ouverte et sans redire bonjour. Un bandeau indique l'étape en cours ; en cas d'échec (conflit git, erreur de compilation) il affiche le message, l'ancienne version reste en place (retour arrière automatique en cas d'échec de compilation d'un nouveau commit). Le chemin `~/Applications/AlphaCris.app` ne change jamais : l'app charge le code du dépôt, qui est mis à jour sur place.
- Première fois seulement : une version qui n'a pas encore le bouton se met à jour par l'ancien chemin (⚙ → Version → mettre à jour, ou `git pull origin cursor/mac-launcher-mvp-4e86 && cd apps/launcher && npm install && npm run build`), puis tout se fait avec **Recharger**.
- `⌘R` (menu AlphaCris → « Recharger l'interface ») recharge seulement la page, sans recompiler.

**Dans Cursor (mode développement, rechargement à chaud)** :

```bash
cd apps/launcher
npm run dev                                   # quitter d'abord AlphaCris (⌘Q) : une seule instance à la fois
npm run dev -- --user-data-dir=/tmp/alphacris-dev   # variante avec des réglages vierges, en parallèle de l'app installée
```

`npm run dev` compile une fois, puis lance `tsc --watch` (processus principal et interface) et Electron avec `--dev --show`. Modifier `src/renderer/*` (TypeScript, HTML, CSS) recharge la fenêtre en une fraction de seconde ; modifier `src/main`, `src/core` ou `src/preload` relance Electron automatiquement. `Ctrl+C` arrête tout. Les arguments après `--` sont transmis à Electron.

### Lancer sans Terminal, et mises à jour

```bash
npm run app:install   # crée ~/Applications/AlphaCris.app (à faire une seule fois)
```

Ensuite : double-clic sur **AlphaCris** (Finder, Launchpad, Spotlight), ou glisser l'app dans le Dock. Pour qu'elle démarre à la connexion : Réglages Système → Général → Éléments de connexion → `+`. `AlphaCris.app` est une copie d'Electron renommée (nom, identifiant `app.lycapps.alphacris`, signature locale ad hoc) qui charge le code de ce dossier : le chemin est mémorisé, si vous déplacez le dossier relancez `npm run app:install`. L'ancien « Cursor Launcher.app » est supprimé automatiquement ; si l'ancienne version tourne encore, la quitter (⌘Q) avant d'ouvrir AlphaCris. Si la copie d'Electron échoue, le script installe un petit lanceur de secours du même nom.

**Renommage : rien n'est perdu.** Les données gardent leur emplacement : réglages, historique et clé chiffrée dans `~/Library/Application Support/Cursor Launcher/`, modèles Whisper dans `~/.cursor-launcher/`. Le nom interne « Cursor Launcher » (champ `productName` de `package.json`) est conservé exprès : il détermine ce dossier et l'entrée « Safe Storage » du Trousseau. Au premier lancement d'AlphaCris, macOS peut redemander l'accès au Trousseau (nouvelle identité d'app) : choisir « Toujours autoriser » ; si la clé n'est plus lisible, l'app l'indique et on la ressaisit dans ⚙. L'accès au micro et aux dossiers est aussi redemandé une fois (nouvel identifiant). L'environnement du shell de connexion (`~/.zprofile` : PATH Homebrew, `CURSOR_API_KEY`…) est relu au lancement depuis le Finder.

**Mises à jour** (depuis le dépôt git, sans `.dmg` ni signature Apple) :
- Au démarrage (réglage « Mises à jour auto », activé par défaut) : `git fetch`, puis si des nouveautés existent `git pull --ff-only`, `npm install` seulement si `package.json`/`package-lock.json` ont changé, `npm run build`, et l'app redémarre toute seule. Décochable dans le menu de la barre de menus ou les réglages.
- À la demande : icône de la barre de menus → **Mettre à jour (N nouveautés)…** (ou **Vérifier les mises à jour**), ou ⚙ → « Version » → bouton. Une vérification est aussi faite toutes les 6 h ; une notification signale une nouveauté disponible (appliquée seulement au démarrage ou sur clic).
- Garde-fous : jamais de `reset --hard`/force ; si vous avez des modifications locales en conflit, `git pull` échoue et rien n'est écrasé ; si la compilation échoue, retour à la version précédente (`git reset --keep`) et message d'erreur.
- La branche locale doit suivre une branche distante (c'est le cas après un `git clone` ou `git pull origin <branche>`). Si la branche de la PR est supprimée après fusion, faire `git checkout main && git pull` puis `npm run build` une fois.
- Les mises à jour s'exécutent via un shell de connexion (`/bin/zsh -l`) pour retrouver `git` et `npm` (Homebrew, nvm…).
- Un `.dmg` installé (sans dépôt git) n'a pas ce mécanisme : le menu indique « indisponible ». Une mise à jour automatique d'un `.dmg` (electron-updater + GitHub Releases) exige une app **signée** par un compte Apple Developer payant, ce qui n'est pas en place.

Attention : une app lancée depuis le Finder ne lit que `~/.zprofile` / `~/.zshenv` (shell de connexion), pas `~/.zshrc` : pour `CURSOR_API_KEY`, saisissez la clé dans ⚙ → Clé API (Trousseau) ou exportez-la dans `~/.zprofile`.

**Item de barre de menus invisible** (l'app tourne pourtant : `Option+Espace` fonctionne). L'app ne dépend plus de cet item :
- **Titre texte « AlphaCris »** affiché à côté de l'icône (un texte n'est pas une image « template » que macOS peut rejeter) ; il est forcé si l'icône est jugée inutilisable (vide, taille 0). Décochable seulement quand l'icône est valide : ⚙ → « Nom dans la barre de menus ».
- **Détection au démarrage** : si `tray.getBounds()` est vide ou hors écran (contrôle immédiat puis à 0,5 s, 1,5 s, 4 s), le Dock s'affiche **et** la fenêtre s'ouvre tout de suite avec l'explication. Un lancement manuel (double-clic) ouvre toujours la fenêtre ; seul le lancement à la connexion reste silencieux.
- **Quitter sans l'item** : bouton ⏻ à droite de la barre de saisie, bouton « Quitter AlphaCris » dans ⚙, `⌘Q` fenêtre affichée (`Option+Espace`), clic droit sur l'icône du Dock → Quitter. À la main : ⚙ → « Afficher dans le Dock ».
- L'item a maintenant sa propre identité (`app.lycapps.alphacris`) : une entrée « Electron » désactivée dans Réglages Système → Barre des menus ne s'applique plus. Si malgré tout il manque : même panneau → « Autoriser dans la barre des menus » → AlphaCris, ou libérer de la place (⌘ + glisser les autres icônes hors de la barre, surtout sous l'encoche).

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
| Écran principal | Au lancement : une **scène vocale** (orbe et ondes qui réagissent au niveau du micro quand vous parlez, à la voix de l'assistant quand il répond, et « réfléchissent » pendant qu'un agent travaille). Toucher l'orbe ou 🎙 lance la conversation vocale. Le fil de texte (bulles, champ de saisie) est un panneau plus petit sur la droite. |
| Instruction à l'agent | Taper dans le panneau de droite puis `Entrée` (`Maj+Entrée` = saut de ligne, `↑`/`↓` = historique). `⌘N` ou « Nouvelle conversation » repart de zéro. Ex. « Crée une petite app web de to-do list dans mon dossier Projects », « Quels sont les 5 plus gros fichiers de Downloads ? » |
| Ranger un dossier | Glisser le dossier sur la fenêtre (ou 📁), taper la consigne (« range par année puis par type ») puis `Entrée` pour l'aperçu. `⌘Entrée` = rangement par type **sans IA**. |
| Répondre à l'agent | Quand l'agent a besoin d'une précision, une carte apparaît dans le fil : cliquer un bouton (ou touche `1`–`9` quand le champ est vide) ou écrire sa réponse dans la barre de prompt. `Échap` refuse de répondre et interrompt la demande. |
| Suivre l'avancement | Pendant une demande : barre animée, temps écoulé, nombre d'actions et étape en cours (« Lit … », « Exécute : … », « ⏸ En attente de votre confirmation »). Le pourcentage réel n'est pas connaissable (nombre d'étapes inconnu) : la barre est donc indéterminée. `Échap` annule. |
| Parler | Cliquer 🎙 ou `Option+Maj+Espace` depuis n'importe où : conversation vocale ([détails](#conversation-vocale)). `Maj`+clic sur 🎙 = dictée simple (le texte est placé dans la barre, à relire avant `Entrée`). `Échap` ou re-clic termine. |

### Mode dossier

1. **Aperçu (dry-run, par défaut)** : le plan liste chaque déplacement `source → destination`, que l'on peut décocher. Rien n'est modifié.
2. **Appliquer…** ouvre une confirmation explicite.
3. L'application revérifie chaque déplacement : pas d'écrasement, pas de sortie du dossier, pas de lien symbolique vers l'extérieur.
4. **Annuler ce rangement** remet les fichiers en place (et retire les sous-dossiers devenus vides).

Portée : fichiers du premier niveau (hors fichiers cachés et sous-dossiers), 500 fichiers max. Le plan « IA » n'envoie au fournisseur que les **noms, tailles et dates** — jamais le contenu. Aucune suppression ni renommage.

### Conversation vocale

Inspirée de [jarvis-assistant-vocal](https://github.com/sosoj92/jarvis-assistant-vocal) (licence **MIT**, voir `THIRD_PARTY_NOTICES.md`) : ce dépôt est en Python/Windows, aucun code n'a été copié ; on reprend les idées et on les réécrit en TypeScript pour Electron/macOS.

| Idée de Jarvis | Ce qu'on en a fait |
| --- | --- |
| Détection de parole par énergie, auto-calibrée sur le bruit ambiant | `src/renderer/audio.ts` : seuils calés sur le bruit de la pièce, fin de phrase après ~1,1 s de silence, claquements ignorés |
| Écoute de suite sans répéter le mot d'activation | Après chaque réponse, le micro reste ouvert `followUpSeconds` (8 s) ; silence = fin de conversation |
| Mots d'arrêt | « merci, c'est tout », « stop », « à bientôt »… (`isEndPhrase`) |
| Filtre des hallucinations de Whisper | `cleanTranscript` : retire `[musique]`, « Sous-titres réalisés par… », « Merci d'avoir regardé » |
| Réponses courtes à l'oral | Préfixe « mode vocal » (1 à 3 phrases) envoyé à l'agent ; `plainForSpeech` retire Markdown, liens, emojis ; tableaux et code restent à l'écran |
| Synthèse phrase par phrase, interruptible | Voix neuronale **Piper** (locale, gratuite) si installée, sinon `say` du Mac ; une phrase à la fois : `Échap` ou clic sur 🎙 coupe net |
| Confirmation orale stricte | « oui » explicite requis ; « non », « attends », un doute ou un silence valent refus (`interpretConfirmation`) |
| Mot d'activation | Écoute locale + Whisper + comparaison floue (pas le modèle openWakeWord de Jarvis : voir limites) |

**Installer (gratuit, local, une fois)** :

```bash
cd apps/launcher
npm run voice:install            # brew install whisper-cpp + modèle « small » (~470 Mo) dans ~/.cursor-launcher/models
npm run voice:install -- base    # variante plus légère/rapide (~150 Mo)
```

Puis relancer l'app. Sans cette installation, la voix utilise une clé Whisper (API) si elle existe. Moteur réglable : réglages → Voix → « Moteur de dictée » (automatique : local si installé, sinon API).

### Modifier AlphaCris en lui parlant (voix, thème, comportement)

Sans passer par Cursor ni par l'écran de réglages, on peut demander à l'agent (à la voix ou à l'écrit) de changer certains réglages. Ils sont **enregistrés et appliqués immédiatement**, sans redémarrage, et l'agent confirme en une phrase ce qui a changé (lue à voix haute en conversation vocale).

| Outil | Ce qu'il change | Exemples à dire |
|---|---|---|
| `set_voice` | moteur (Piper / voix du Mac / auto), voix du Mac, voix Piper **déjà installée**, débit (80–400 mots/min) | « Passe sur la voix Thomas », « parle moins vite », « reviens à Piper » |
| `set_theme` | couleur principale, seconde couleur, fond (sombre), opacité du fond « glass » (25–100 %), visibilité de la bordure (0–60 %), préréglages `defaut`, `ocean`, `foret`, `couchant`, `rose`, `graphite`, retour au thème d'origine | « Mets le thème océan », « fenêtre plus transparente », « supprime la bordure », « accent rose » |
| `set_behavior` | bonjour au lancement, mot d'activation (on/off), phrase d'activation, durée d'écoute de suite (2–30 s), lecture des réponses écrites | « Arrête de dire bonjour au démarrage », « écoute 15 secondes après ma demande », « change le mot d'activation en ok Cris » |
| `get_app_settings` | lecture seule : état actuel et voix disponibles | « Quelles voix as-tu ? » |

Garde-fous :

- **Seulement des réglages et le thème.** L'agent ne modifie jamais le code d'AlphaCris : `write_file`, `move_file`, `trash_file`, `create_project` et le dossier de travail de `run_shell` refusent tout chemin situé dans le dépôt de l'application (même s'il est dans les dossiers autorisés), et le prompt lui demande de répondre à voix haute que « ça demande de modifier le code, il faut passer par Cursor » quand la demande dépasse les réglages (nouveau comportement, nouveau bouton…). Limite assumée : une commande shell approuvée au clic reste non confinée (voir plus bas), c'est la confirmation qui protège.
- Pas d'accès aux clés API, au fournisseur, aux dossiers autorisés ni aux raccourcis ; valeurs validées et bornées (couleurs `#rrggbb`, fond obligatoirement sombre et accents visibles pour que l'interface reste lisible, voix du Mac contrôlée contre la liste réelle, voix Piper contrôlée contre `~/.cursor-launcher/voices`, jamais un chemin donné par le modèle).
- **Activer le mot d'activation demande une confirmation explicite** (micro ouvert en permanence) ; refus = rien ne change. La désactiver est libre.
- Pour revenir en arrière : « remets le thème d'origine », ou ⚙ → Thème → « Rétablir le thème d'origine ». Les mêmes réglages sont aussi modifiables à la main dans ⚙ (section « Thème » : sélecteurs de couleur, curseurs de transparence et de bordure, aperçu en direct).

**Fenêtre « glass »** : fond translucide teinté, bordure d'un pixel très discrète (10 % de blanc par défaut), ombre légère, sans anneau noir. La transparence est celle du CSS (la fenêtre Electron est transparente) : elle ne floute pas le bureau derrière, donc un fond très transparent sur un bureau chargé peut nuire à la lisibilité (plancher à 25 %).

### Bonjour au lancement

À chaque démarrage, AlphaCris dit « Bonjour, c'est Cris, à ton service. » (Piper si installé, sinon `say`) pendant que l'orbe s'anime. Le nom reste affiché « Cris » / « AlphaCris » ; pour la voix il est écrit « Criss » (`src/core/greeting.ts`, `pronounceForSpeech`) afin que le moteur dise /kʁis/ (comme « criss ») et non « cri » : la même règle s'applique à toute réponse lue (« Cris » et « AlphaCris » → « Criss », « Alpha Criss » ; le mot « cris » en minuscules n'est pas touché). Pas de bonjour après « Recharger », après une mise à jour automatique ni dans l'interface rechargée. À désactiver : ⚙ → Voix → « Dire bonjour au lancement ». Le modèle Piper est chargé dès le début du démarrage pour que le bonjour parte tout de suite.

### Une voix de qualité (Piper, gratuit, local)

La voix `say` du Mac est correcte mais mécanique. Jarvis (jarvis-assistant-vocal) utilise **Piper** pour son mode local, avec la voix française `fr_FR-siwis`, après avoir comparé Kokoro (une seule voix française, qualité moyenne) : on reprend ce choix. Piper est une voix neuronale qui tourne sur le CPU (temps réel, y compris sur Mac sans GPU), sans clé ni abonnement ni connexion une fois installée.

```bash
cd apps/launcher
npm run tts:install                        # Piper + voix française fr_FR-siwis-medium (~65 Mo), puis une phrase d'essai
npm run tts:install -- fr_FR-upmc-medium   # autre voix du catalogue rhasspy/piper-voices (voir ci-dessous)
```

Le script crée un environnement Python isolé dans `~/.cursor-launcher/piper` (Python 3.9+ ; sinon `xcode-select --install` ou `brew install python`) et télécharge la voix dans `~/.cursor-launcher/voices`. Puis relancer l'app : **rien d'autre à régler**, le moteur « Automatique » prend Piper dès qu'il est installé et garde `say` sinon.

Réglages → Voix :
- **Moteur de voix** : Automatique (Piper si installé), Piper (seul : l'état affiche pourquoi il n'est pas utilisable) ou Voix du Mac.
- **État de la voix** : dit quel moteur parle réellement et ce qui manque, le cas échéant.
- **Débit (mots/min)** : commun aux deux moteurs (185 = voix naturelle ; converti en durée des phonèmes pour Piper).
- **Voix Piper (.onnx)** et **Python / binaire Piper** : chemins personnalisés (ex. une autre voix déposée dans `~/.cursor-launcher/voices`, ou le `piper` d'un autre emplacement). Laisser vide pour la détection automatique (voix `fr_FR-siwis-medium`, sinon la première voix française, sinon la première voix trouvée).
- **Voix du Mac (repli)** : voix `say` utilisée si Piper n'est pas installé ou échoue.

Fonctionnement : un processus Piper reste ouvert pendant la conversation (le modèle n'est chargé qu'une fois ; il s'arrête après 5 minutes d'inactivité et à la fermeture de l'app), chaque phrase produit un petit fichier WAV temporaire lu par `afplay` puis supprimé. Si Piper plante ou ne répond pas, la phrase est dite avec `say` et Piper est écarté jusqu'au prochain changement de réglages : la conversation n'est jamais bloquée.

**Licences** : Piper (paquet `piper-tts`, https://github.com/OHF-Voice/piper1-gpl) est en **GPL-3.0** ; il n'est ni embarqué ni lié à l'application, seulement installé à part et lancé comme programme externe (aucun de ses fichiers n'est dans ce dépôt). Les voix ont chacune leur licence (fiche `MODEL_CARD` à côté de chaque voix sur https://huggingface.co/rhasspy/piper-voices) : `fr_FR-siwis` est en **CC-BY 4.0** (usage libre, y compris commercial, avec mention de la base SIWIS de l'université d'Édimbourg, voir `THIRD_PARTY_NOTICES.md`) ; `fr_FR-upmc` est en CC-BY-SA 4.0 ; `fr_FR-tom` est en AGPL-3.0 : à éviter si l'app est redistribuée.

**Utiliser** : cliquer 🎙 (ou `Option+Maj+Espace`), parler, attendre la réponse lue ; on peut enchaîner sans recliquer. Quand l'agent demande une confirmation, il la lit et attend « oui » ou « non » (ou un clic) ; quand il pose une question à choix, répondre « le deuxième » ou le nom de l'option. Les actions **dangereuses** (rouge : `rm -r`, `sudo`, Corbeille…) ne se valident **qu'au clic**. Réglages → Voix : lire aussi les réponses tapées, voix et débit du Mac, confirmations orales, durée d'écoute après réponse.

**Mot d'activation (expérimental, désactivé par défaut)** : réglages → Voix → « Mot d'activation » (par défaut « hey cursor »). Le micro écoute en permanence, **sans jamais envoyer d'audio hors du Mac** : seul Whisper local est utilisé, même si le moteur est réglé sur « API ». Coût : un peu de CPU à chaque phrase entendue ; l'indicateur micro de macOS reste allumé. Dire « hey cursor, range mon dossier Téléchargements » ouvre la fenêtre et lance la demande.

**Sécurité inchangée** : la voix ne contourne rien. Le périmètre de dossiers s'applique, chaque action sensible passe par la même confirmation (à la voix ou au clic), et l'audio n'est conservé que le temps de la transcription (fichier temporaire 0600 supprimé aussitôt). Avec l'API Whisper, l'audio de la phrase part chez le fournisseur ; avec Whisper local, rien ne quitte le Mac. La voix de Cursor n'est pas réutilisable (aucune API) : on utilise Piper (local) ou les voix du Mac.

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
| **Accès complet au disque** | Si l'agent doit lire des dossiers protégés (Mail, Messages, Safari…) ou si les invites ci-dessus ne suffisent pas | Confidentialité → Accès complet au disque → ajouter AlphaCris |
| **Accessibilité** | Pas requis par le MVP. Les raccourcis globaux utilisent `globalShortcut` (Carbon `RegisterEventHotKey`) qui n'exige pas cette permission. Nécessaire seulement si l'on ajoute plus tard du pilotage d'UI (AppleScript « System Events », saisie simulée) | Confidentialité → Accessibilité |
| **Automatisation** | Si l'agent pilote d'autres apps via `osascript` (invite par app cible) | Confidentialité → Automatisation |

En développement (`npm start`), c'est l'application **Electron** (ou votre Terminal) qui apparaît dans ces listes, pas « AlphaCris ».

## Packaging `.dmg`

```bash
cd apps/launcher
npm run dist         # build + electron-builder --mac dmg  → release/*.dmg (arm64 + x64)
```

La configuration est dans `package.json` (`build`) : `LSUIElement` (pas de Dock), textes d'usage du micro et des dossiers, `hardenedRuntime`, entitlements (`build/entitlements.mac.plist` : micro, Apple Events, JIT pour V8). Sans certificat Apple Developer, l'app n'est pas signée : au premier lancement, clic droit → Ouvrir (ou `xattr -dr com.apple.quarantine "/Applications/AlphaCris.app"`). Pour distribuer proprement : variables `CSC_LINK` / `CSC_KEY_PASSWORD` (signature) et `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` (notarisation). Aucune icône d'application n'est fournie (icône Electron par défaut) : ajouter `build/icon.icns`.

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
  theme.ts         Thème (couleurs, glass, bordure) : validation, préréglages, contraste
  appcontrol.ts    Réglages modifiables par l'agent (voix, thème, comportement) : validation et confirmations
  transcribe.ts    Whisper via API (multipart /audio/transcriptions)
  whisper.ts       Whisper local (whisper.cpp) : détection du binaire/modèle, transcription
  voice.ts         Voix pure : texte → oral, voix du Mac, oui/non, choix, mot d'activation, filtre Whisper
src/main/        Processus principal Electron : fenêtre, tray, raccourcis, IPC, trousseau (safeStorage), synthèse vocale (Piper, `say` en repli)
src/preload/     Pont contextBridge minimal (API typée, pas d'accès Node)
src/renderer/    UI (HTML/CSS/TS sans framework) : barre de prompt, aperçu de plan, confirmations, réglages ; audio.ts (VAD, WAV), voice.ts (micro)
test/            Tests Vitest
scripts/         copy-assets, gen-icons (icône tray), e2e-smoke et e2e-voice (Linux/Xvfb), install-voice, install-mac-app
```

Le renderer ne touche jamais au disque : tout passe par l'IPC vers le processus principal, qui applique périmètre et confirmations. Les confirmations sont demandées au renderer (`confirm:request`) et bloquent l'outil jusqu'à la réponse ; masquer la fenêtre vaut refus.

## Tests

```bash
npm test             # 206 tests unitaires/intégration (Vitest)
npm run typecheck
npm run build
npm run e2e:linux    # app Electron réelle sous Xvfb + faux serveur LLM (nécessite xvfb-run)
npm run e2e:voice    # conversation vocale réelle : micro simulé (espeak-ng), faux Whisper/say, bonjour au lancement (xvfb-run + espeak-ng)
npm run e2e:reload   # bouton Recharger : dépôt git temporaire, nouveau commit, pull + build + relance (Xvfb + git)
```

Couverture : périmètre (traversée, liens symboliques, préfixes voisins), classification shell, chaque outil (confirmation, refus, non-écrasement, timeout shell), boucle agent (erreurs d'outils, limite d'étapes, annulation), client LLM, mode dossier (dry-run, sélection partielle, collisions, re-vérification, annulation, autorisation hors périmètre), stockage des réglages/historique, transcription, résolution des clés, mémoire de conversation, outil `ask_user`, analyseur Markdown, mise à jour git (nouveautés, `npm install` conditionnel, échec de compilation avec retour arrière, modifications locales, dépôt injoignable, sur de vrais dépôts temporaires). Voix : détection de parole (bruit, claquements, clics), WAV, texte→oral, oui/non strict, choix oral, mot d'activation, filtre Whisper, whisper.cpp local (fausses commandes + un test avec le vrai binaire si `WHISPER_BIN`/`WHISPER_MODEL`/`WHISPER_SAMPLE` sont définis), `say`. `e2e:reload` publie un commit dans un dépôt temporaire, clique sur « Recharger » dans la vraie app et vérifie la nouvelle version après relance. `e2e:voice` joue de vraies phrases dans la vraie app (conversation, confirmation « oui », « merci c'est tout », mot d'activation, et vrai whisper.cpp si `WHISPER_BIN`/`WHISPER_MODEL`). Le test e2e Linux couvre aussi le fil de conversation, les boutons de réponse, le rendu Markdown et « Nouvelle conversation ».

## À vérifier sur Mac

Non testable depuis la VM Linux :

- [ ] `Option+Espace` : raccourci global, éventuel conflit avec Spotlight/Alfred/clavier (changer dans les réglages), affichage au-dessus des apps en plein écran et sur tous les Spaces.
- [ ] Pas d'icône Dock (`setActivationPolicy('accessory')` + `LSUIElement` dans le `.dmg`), icône « template » correcte en mode clair/sombre, menu de la barre de menus.
- [ ] **Barre de menus** : icône template (32 px @2x, `createFromBuffer`) + titre « AlphaCris » visibles ; si masqués, Dock + fenêtre immédiats (`tray.getBounds()` vide/hors écran : heuristique non vérifiée sur Mac) ; `⌘Q`, bouton ⏻, bouton dans ⚙ et « Afficher dans le Dock » quittent bien l'app.
- [ ] Prise de focus de la fenêtre depuis une autre app, masquage à la perte de focus, restitution du focus à l'app précédente (`app.hide()`).
- [ ] **Recharger** : bouton / `⇧⌘R` depuis `AlphaCris.app` lancée par le Finder (`git`/`npm` retrouvés via le shell de connexion, `app.relaunch` avec la copie d'Electron renommée, fenêtre qui revient), et `npm run dev` dans Cursor.
- [ ] **Glass et réglages à la voix** : rendu de la fenêtre translucide sur un vrai bureau (lisibilité, bordure discrète, ombre non coupée sur écran Retina), « mets le thème océan » / « parle moins vite » / « arrête le bonjour » dits au micro, et la confirmation parlée avec la nouvelle voix.
- [ ] **Scène vocale** : fluidité de l'orbe (canvas 2D) sur l'écran Retina, réaction au vrai micro, bonjour dit par Piper dès l'ouverture (prononciation « criss »).
- [ ] Lancement au login (`setLoginItemSettings`, visible dans Réglages Système → Général → Éléments de connexion).
- [ ] **Fournisseur Cursor** avec une vraie clé : un prompt avec appel d'outil (ex. « liste mon dossier Downloads »), confirmation affichée pour un shell, annulation (Échap), « Lister les modèles » et sélection d'un modèle Claude, mode dossier. Vérifier aussi que le modèle appelle bien nos outils `custom-user-tools` (et qu'aucun outil intégré Cursor n'est proposé), le chargement du SDK dans l'app packagée (`asarUnpack`, binaire darwin) et l'usage « SDK » dans le tableau de bord Cursor.
- [ ] **Voix** (rien de cela n'a pu être essayé sur un vrai Mac) :
  - `npm run voice:install` (Homebrew, modèle) puis un 🎙 : invite micro macOS, `AudioContext` 16 kHz + `ScriptProcessor` dans Electron macOS, seuils de détection avec le vrai micro (trop sensible / trop sourd ? voir `src/renderer/audio.ts`), précision de Whisper `small` en français.
  - Synthèse `say` : voix française choisie automatiquement (Amélie/Thomas/Audrey si installées), débit 185, coupure avec `Échap`.
  - `npm run tts:install` : `python3 -m venv` + `pip install piper-tts` avec le Python du Mac (3.9 des outils Xcode), wheel `macosx_11_0_arm64`/`x86_64`, puis phrase d'essai jouée par `afplay` ; qualité de la voix `siwis` à l'oreille ; latence de la première phrase (chargement du modèle) et enchaînement entre phrases.
  - Écho : la parole de l'assistant ne doit pas être reprise par le micro (l'écoute ne reprend que 250 ms après la fin de la phrase ; à tester sur haut-parleurs de MacBook).
  - Confirmation orale « oui »/« non » sur une vraie commande shell ; vérifier qu'une action rouge n'est validable qu'au clic.
  - Mot d'activation « hey cursor » : taux de reconnaissance, faux déclenchements, consommation CPU, fenêtre cachée (`backgroundThrottling: false`).
  - Raccourci `Option+Maj+Espace` : il **bascule** la conversation (`globalShortcut` ne détecte pas le relâchement d'une touche, donc pas de push-to-talk).
- [ ] `open -a` pour « ouvrir une app », Corbeille (`shell.trashItem`), invites d'accès aux dossiers Bureau/Documents/Téléchargements.
- [ ] Trousseau : `safeStorage` (invite d'accès au Trousseau à la première utilisation, clé conservée entre deux lancements).
- [ ] Conversation : mise en page (fenêtre 780×680), saisie multi-lignes avec dictée, cartes de question (boutons + saisie libre) et de confirmation avec une vraie clé Cursor : vérifier que le modèle appelle bien `ask_user` quand il manque une information, et que la mémoire de l'agent Cursor est conservée d'un message à l'autre.
- [ ] `npm run app:install` : l'app « AlphaCris.app » (copie d'Electron renommée, re-signée `codesign --sign -`) se lance au double-clic avec le bon nom dans le Dock/menu, au login, avec le PATH et les variables de `~/.zprofile`, et le menu « Mettre à jour » fonctionne depuis cette app (PATH du shell de connexion, `git pull`, `npm install`, redémarrage automatique). Testé sur Linux avec un vrai dépôt distant : pull, compilation et relance automatique OK.
- [ ] Drag & drop d'un dossier depuis le Finder (`webUtils.getPathForFile`).
- [ ] `npm run dist` : génération du `.dmg` arm64/x64, signature/notarisation.

## Limites et pistes

- Un seul fournisseur à la fois (Cursor, ou OpenAI-compatible) ; pas de streaming des réponses mot à mot (réponse affichée en fin d'étape).
- Mémoire de conversation limitée aux 60 derniers messages (fournisseurs OpenAI-compatibles) et non conservée après redémarrage de l'app.
- Le rendu Markdown est volontairement minimal (pas d'images, pas de HTML, liens `http(s)`/`mailto` seulement).
- Mode dossier non récursif ; l'annulation ne couvre que le dernier rangement de la session.
- Pas de pilotage d'UI (clics, saisie) ni de lecture d'écran : prévu après validation du MVP.
- Voix : pas d'interruption à la voix pendant que l'assistant parle (écoute coupée pendant la réponse, anti-écho) : `Échap`/clic pour couper ; transcription par phrase complète (pas de streaming) donc 1 à 3 s de latence avec Whisper `small` ; le mot d'activation passe par une transcription et non par un modèle dédié (openWakeWord, utilisé par Jarvis, est sous licence CC-BY-NC-SA : non commerciale, non reprise) donc moins précis et plus gourmand ; voix Piper (siwis, voix unique, ton neutre, pas de contrôle d'émotion) ou `say` en repli, la dictée macOS native et la Web Speech API ne sont pas utilisées (Chromium sans clés Google).
- Pas de tests automatisés de l'UI macOS native ni de CI dédiée.
