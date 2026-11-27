import { constants } from "node:fs";
import { copyFile, lstat, realpath, rename } from "node:fs/promises";
import path from "node:path";
import { isSyncPath } from "./files.mjs";

export function validProjectName(name) {
  return typeof name === "string" && name.trim() === name && name.length > 0 &&
    name.length <= 255 && !name.startsWith(".") && name.toLowerCase() !== "node_modules" &&
    !/[\\/:\u0000-\u001f]/.test(name) && isSyncPath(name);
}

export async function projectEntry(root, relative, directoryOnly = false) {
  if (relative === "" && directoryOnly) return { file: root, info: await lstat(root) };
  if (typeof relative !== "string" || !relative.split("/").every(validProjectName)) {
    throw new Error("Choose a visible file or folder inside the project.");
  }
  const file = path.join(root, relative);
  if (await realpath(path.dirname(file)) !== path.dirname(file)) throw new Error("Quire skips symbolic links.");
  const info = await lstat(file);
  if (!info.isDirectory() && (directoryOnly || !info.isFile())) throw new Error("Choose a regular project file or folder.");
  return { file, info };
}

export const relocatePath = (value, from, to) => value === from ? to :
  value?.startsWith(from + "/") ? to + value.slice(from.length) : value;

export async function moveProjectEntry(root, from, to) {
  const { file, info } = await projectEntry(root, from);
  if (from === to) return;
  if (typeof to !== "string" || !to.split("/").every(validProjectName) || to.startsWith(from + "/")) {
    throw new Error("Choose a valid destination outside the item being moved.");
  }
  const destination = path.join(root, to);
  await projectEntry(root, path.posix.dirname(to) === "." ? "" : path.posix.dirname(to), true);
  const occupant = await lstat(destination).catch(error => {
    if (error.code !== "ENOENT") throw error;
  });
  const isCaseChange = from.toLowerCase() === to.toLowerCase() && info.dev === occupant?.dev && info.ino === occupant?.ino;
  if (occupant && !isCaseChange) throw new Error("A file or folder with that name already exists here.");
  await rename(file, destination);
}

export async function importProjectFiles(root, folder, paths) {
  const { file: directory } = await projectEntry(root, folder, true);
  const added = [];
  const skipped = [];
  for (const source of paths) {
    const name = path.basename(source);
    try {
      if (!validProjectName(name) || !(await lstat(source)).isFile()) {
        skipped.push(name);
        continue;
      }
      await copyFile(source, path.join(directory, name), constants.COPYFILE_EXCL);
      added.push(path.posix.join(folder, name));
    } catch (error) {
      skipped.push(name);
      if (!["EEXIST", "ENOENT", "EACCES", "EPERM", "EISDIR"].includes(error.code)) {
        return { added, skipped, error: error.message };
      }
    }
  }
  return { added, skipped };
}
