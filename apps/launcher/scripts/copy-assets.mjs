import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("dist/renderer", { recursive: true });
for (const f of ["index.html", "styles.css"]) copyFileSync(`src/renderer/${f}`, `dist/renderer/${f}`);
