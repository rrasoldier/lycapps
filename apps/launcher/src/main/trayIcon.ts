import { nativeImage, type NativeImage } from "electron";

/**
 * Icône de la barre de menus (silhouette noire sur fond transparent = image « template » : macOS la teinte
 * selon le thème). Elle est embarquée dans le code : aucun chemin de fichier ni dossier `resources/` à retrouver,
 * donc plus de cas où l'icône serait vide (app lancée via le wrapper, copiée ailleurs, etc.).
 * Reflète `resources/trayTemplate*.png` (généré par `scripts/gen-icons.mjs`, vérifié par un test).
 */
export const TRAY_ICON_1X = "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAfElEQVR4nLVSsQ3AIAzz2me4hb2vcBUL7+SDntAKyUhRRKAqxZKXEDsOAGzACSADEDKzNsXB5tthZo8LK75Ia+LG1sKozqIx6q6jp1dBAFDIwNowhajpoLAJCmsthWwxWF5h+RJtCu8ZK5NnMPtIr0ww+MrJmHxCWjX4Hw+mgmKLPNatgAAAAABJRU5ErkJggg==";
export const TRAY_ICON_2X = "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAA9klEQVR4nO2WwQ2DMAxF35Ejc3DOFNzYgClQlkIMwLEbsETHaFXJBxTZKEkDQVWf5Etw8E9sJ4E/aTSAA3oxJ2OnMwIr8DJsFZ/ifFa5HQQObZM5RZgSAoc21Qz+tYj+4KcPwAODmJcxyz8rHVrOnxLQYhAfrSaSGI3gXcTczhCR1B1aq2krb8VCBqNFo2iMnIeBl933RRGi1UTUYeWUiT7wWRSfJfDxio+LEaBV/37724Nq3++CloaobqguoHoKqhchtduQOxxE1D6KKXwZzTkCKHQd/4aInCfZXFoEGY/SU0SQ+Cw/TUQKlohL0URcTijiz314A+aYSTeU/9gzAAAAAElFTkSuQmCC";

export function createTrayIcon(): NativeImage {
  // Une seule représentation @2x (32 px = 16 pt) : c'est la forme la plus fiable pour un item de barre de menus.
  const icon = nativeImage.createFromBuffer(Buffer.from(TRAY_ICON_2X, "base64"), { scaleFactor: 2 });
  icon.setTemplateImage(true);
  return icon;
}
