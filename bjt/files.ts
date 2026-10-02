/**
 * Writing a file so that it is either the old one or the new one, never half.
 *
 * A bundle, its SQL, a clip or a picture is read by something that trusts it:
 * the next night counts a bundle's cells as spent, the deploy applies the SQL,
 * the survey counts a picture on disk as artwork and the upload sends it. A
 * process stopped part-way through a plain `writeFileSync` — the job's clock,
 * a full disk, Ctrl-C — leaves a truncated file that every one of those
 * readers takes for the real thing. So the bytes go to a temporary file beside
 * the target and are moved over it in one step (`renameSync`, atomic on the
 * same filesystem); a write that fails leaves the old file exactly as it was.
 */
import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync, writeSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";

/** Write `data` to `target` whole, or leave `target` as it was. */
export function writeAtomic(target: string, data: Uint8Array | string, opts: { encoding?: BufferEncoding } = {}): string {
  mkdirSync(path.dirname(target), { recursive: true });
  const body = typeof data === "string" ? Buffer.from(data, opts.encoding ?? "utf8") : data;
  const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    const fd = openSync(tmp, "wx");
    try {
      writeSync(fd, body);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, target);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  return target;
}
