/** AsyncStorage for unit tests: an empty in-memory store. Nothing under test
 *  reads it; it exists so the string table can be imported in Node. */
const store = new Map<string, string>();

export default {
  getItem: async (key: string) => store.get(key) ?? null,
  setItem: async (key: string, value: string) => {
    store.set(key, value);
  },
  removeItem: async (key: string) => {
    store.delete(key);
  },
};
