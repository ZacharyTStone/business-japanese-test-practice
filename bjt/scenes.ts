// TEMPORARY: only pictureSceneId, until scenes.py is ported in full.
/**
 * The scene bank: which pictures the library needs, and which exist.
 *
 * (Only the per-item picture's id is here for now; bjt/scenes.py is the
 * reference for the rest.)
 */
import { str } from "./py.ts";

/** Per-item pictures are scenes whose id is the item's id under this prefix,
 *  so they use the same table, bucket and SQL as the bank and nothing else in
 *  the app had to learn a second kind of picture. */
const PICTURE_PREFIX = "pic_";

export function pictureSceneId(itemId: string): string {
  return `${PICTURE_PREFIX}${str(itemId)}`;
}
