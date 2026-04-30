import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function buildPatchPreview(filePath, oldContent, newContent) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "orion-diff-"));
  const oldPath = path.join(tempDir, "old");
  const newPath = path.join(tempDir, "new");

  try {
    await fs.writeFile(oldPath, oldContent, "utf8");
    await fs.writeFile(newPath, newContent, "utf8");

    try {
      const { stdout } = await execFileAsync("git", [
        "diff",
        "--no-index",
        "--no-ext-diff",
        "--",
        oldPath,
        newPath
      ]);
      return stdout
        .replaceAll(oldPath, `${filePath} (current)`)
        .replaceAll(newPath, `${filePath} (proposed)`);
    } catch (error) {
      return error.stdout
        ? error.stdout
            .replaceAll(oldPath, `${filePath} (current)`)
            .replaceAll(newPath, `${filePath} (proposed)`)
        : `--- ${filePath} (current)\n+++ ${filePath} (proposed)\n${newContent}`;
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
