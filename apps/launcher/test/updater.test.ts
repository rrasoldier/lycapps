import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeRunner, Updater } from "../src/core/updater";

const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env, stdio: "pipe" }).toString().trim();

let tmp: string;
afterEach(() => tmp && fs.rmSync(tmp, { recursive: true, force: true }));

/** Dépôt « distant » + copie de l'utilisatrice (apps/launcher) + copie « développeuse » pour publier. */
function setup(buildScript = `node -e "require('fs').writeFileSync('built.txt', require('fs').readFileSync('src.txt','utf8'))"`) {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "launcher-upd-")));
  const remote = path.join(tmp, "remote.git");
  git(tmp, "init", "--bare", "-b", "main", remote);
  const dev = path.join(tmp, "dev");
  git(tmp, "clone", "-q", remote, dev);
  fs.mkdirSync(path.join(dev, "apps/launcher"), { recursive: true });
  fs.writeFileSync(path.join(dev, "apps/launcher/package.json"), JSON.stringify({ name: "x", version: "1.0.0", scripts: { build: buildScript } }));
  fs.writeFileSync(path.join(dev, "apps/launcher/src.txt"), "v1");
  git(dev, "add", "-A");
  git(dev, "commit", "-qm", "v1");
  git(dev, "push", "-q", "-u", "origin", "main");
  const user = path.join(tmp, "user");
  git(tmp, "clone", "-q", remote, user);
  const appDir = path.join(user, "apps/launcher");
  const publish = (version: string, extra?: (dir: string) => void) => {
    fs.writeFileSync(path.join(dev, "apps/launcher/src.txt"), version);
    extra?.(path.join(dev, "apps/launcher"));
    git(dev, "add", "-A");
    git(dev, "commit", "-qm", `Nouveauté ${version}`);
    git(dev, "push", "-q");
  };
  return { appDir, user, publish, updater: new Updater(appDir, makeRunner()) };
}

describe("mise à jour depuis le dépôt git", () => {
  it("à jour : rien à faire", async () => {
    const { updater } = setup();
    const st = await updater.check();
    expect(st.state).toBe("up-to-date");
  });

  it("détecte les nouveautés sans rien modifier, puis les applique et recompile", async () => {
    const { updater, publish, appDir } = setup();
    publish("v2");
    publish("v3");
    const st = await updater.check();
    expect(st).toMatchObject({ state: "available", behind: 2 });
    expect(st.state === "available" && st.subjects).toEqual(["Nouveauté v3", "Nouveauté v2"]);
    expect(fs.readFileSync(path.join(appDir, "src.txt"), "utf8")).toBe("v1");

    const steps: string[] = [];
    const res = await updater.apply((t) => steps.push(t));
    expect(res.changed).toBe(true);
    expect(res.installedDependencies).toBe(false);
    expect(fs.readFileSync(path.join(appDir, "built.txt"), "utf8")).toBe("v3");
    expect(steps.join("|")).toContain("Compilation");
    expect((await updater.check()).state).toBe("up-to-date");
  });

  it("relance npm install quand package.json change", async () => {
    const { updater, publish, appDir } = setup();
    publish("v2", (dir) => {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
      pkg.description = "nouvelle description";
      fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg));
    });
    await updater.check();
    const res = await updater.apply();
    expect(res.installedDependencies).toBe(true);
    expect(fs.existsSync(path.join(appDir, "package-lock.json"))).toBe(true);
  });

  it("compilation en échec : retour à l'ancienne version, message clair", async () => {
    const { updater, publish, appDir } = setup(`node -e "if (require('fs').readFileSync('src.txt','utf8')==='v2') process.exit(1); require('fs').writeFileSync('built.txt','ok-'+require('fs').readFileSync('src.txt','utf8'))"`);
    publish("v2");
    await updater.check();
    await expect(updater.apply()).rejects.toThrow(/compilation a échoué[\s\S]*ancienne version/);
    expect(fs.readFileSync(path.join(appDir, "src.txt"), "utf8")).toBe("v1");
    expect(fs.readFileSync(path.join(appDir, "built.txt"), "utf8")).toBe("ok-v1");
  });

  it("modifications locales en conflit : rien n'est écrasé", async () => {
    const { updater, publish, appDir } = setup();
    fs.writeFileSync(path.join(appDir, "src.txt"), "ma modif locale");
    publish("v2");
    await updater.check();
    await expect(updater.apply()).rejects.toThrow(/git pull a échoué/);
    expect(fs.readFileSync(path.join(appDir, "src.txt"), "utf8")).toBe("ma modif locale");
  });

  it("hors dépôt git ou sans branche suivie : indisponible avec une raison", async () => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "launcher-upd-")));
    const st = await new Updater(tmp, makeRunner()).check();
    expect(st).toMatchObject({ state: "unavailable" });
    await expect(new Updater(tmp, makeRunner()).apply()).rejects.toThrow(/dépôt git/);

    const repo = path.join(tmp, "solo");
    fs.mkdirSync(repo);
    git(repo, "init", "-q");
    const st2 = await new Updater(repo, makeRunner()).check();
    expect(st2.state === "unavailable" && st2.reason).toContain("ne suit aucune branche");
  });

  it("dépôt distant injoignable : indisponible, sans exception", async () => {
    const { updater, user } = setup();
    git(user, "remote", "set-url", "origin", path.join(tmp, "n-existe-pas.git"));
    const st = await updater.check();
    expect(st.state).toBe("unavailable");
  });
});
