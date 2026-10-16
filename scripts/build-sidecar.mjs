// Compile le composant de transcription (wikang-whisper) et le place là où
// Tauri l'attend : src-tauri/binaries/wikang-whisper-<triplet cible>.
import { execSync } from "node:child_process";
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tauriDir = join(root, "src-tauri");
const triple = execSync("rustc -vV").toString().match(/host: (\S+)/)[1];
const profile = process.argv.includes("--debug") ? "debug" : "release";
const ext = process.platform === "win32" ? ".exe" : "";

console.log(`› Compilation de wikang-whisper (${triple}, ${profile})…`);
execSync(`cargo build -p wikang-whisper ${profile === "release" ? "--release" : ""}`, {
  cwd: tauriDir,
  stdio: "inherit",
});
// CARGO_TARGET_DIR moves the build (CI on Windows builds in a short folder: paths stay under 260 characters)
const built = join(process.env.CARGO_TARGET_DIR || join(tauriDir, "target"), profile, `wikang-whisper${ext}`);
if (!existsSync(built)) throw new Error(`binaire introuvable : ${built}`);
mkdirSync(join(tauriDir, "binaries"), { recursive: true });
const dest = join(tauriDir, "binaries", `wikang-whisper-${triple}${ext}`);
copyFileSync(built, dest);
console.log(`✓ ${dest}`);
