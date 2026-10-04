/** expo-secure-store for unit tests: an empty in-memory store. Nothing under
 *  test reads it; it exists so the modules that keep a phone's sign-in can be
 *  imported in Node. */
const store = new Map<string, string>();

export async function getItemAsync(key: string): Promise<string | null> {
  return store.get(key) ?? null;
}
export async function setItemAsync(key: string, value: string): Promise<void> {
  store.set(key, value);
}
export async function deleteItemAsync(key: string): Promise<void> {
  store.delete(key);
}
