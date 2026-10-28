import { safeStorage } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import type { SecretStore } from "../core/service";

/**
 * Secrets chiffrés via safeStorage (clé protégée par le Trousseau macOS).
 * Seul le texte chiffré est écrit sur disque.
 */
export class KeychainSecrets implements SecretStore {
  private data: Record<string, string> = {};

  constructor(private readonly file: string) {
    try {
      this.data = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      this.data = {};
    }
  }

  available(): boolean {
    return safeStorage.isEncryptionAvailable();
  }

  get(name: string): string | undefined {
    const enc = this.data[name];
    if (!enc || !this.available()) return undefined;
    try {
      return safeStorage.decryptString(Buffer.from(enc, "base64"));
    } catch {
      return undefined;
    }
  }

  set(name: string, value: string | null): void {
    if (value === null || value === "") delete this.data[name];
    else {
      if (!this.available()) throw new Error("Le trousseau système n'est pas disponible : utilisez une variable d'environnement.");
      this.data[name] = safeStorage.encryptString(value).toString("base64");
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data), { mode: 0o600 });
  }
}
