import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

describe("icône de barre de menus embarquée", () => {
  const src = fs.readFileSync(path.join(__dirname, "../src/main/trayIcon.ts"), "utf8");
  const embedded = (name: string) => src.match(new RegExp(`${name} = "([A-Za-z0-9+/=]+)"`))?.[1];

  it("correspond aux PNG générés par gen-icons (pas de dérive)", () => {
    expect(Buffer.from(embedded("TRAY_ICON_1X")!, "base64").equals(fs.readFileSync(path.join(__dirname, "../resources/trayTemplate.png")))).toBe(true);
    expect(Buffer.from(embedded("TRAY_ICON_2X")!, "base64").equals(fs.readFileSync(path.join(__dirname, "../resources/trayTemplate@2x.png")))).toBe(true);
  });

  it("est un PNG valide avec de la transparence (RGBA)", () => {
    const png = Buffer.from(embedded("TRAY_ICON_2X")!, "base64");
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png[25]).toBe(6);
  });
});
