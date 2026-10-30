import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";

const cwd = new URL("./", import.meta.url);
const files = readdirSync(new URL("test/", cwd))
  .filter((name) => name.endsWith(".test.ts") && name !== "render.test.ts")
  .sort()
  .map((name) => `test/${name}`);
const result = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", "--test", ...files], {
  cwd, stdio: "inherit",
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
