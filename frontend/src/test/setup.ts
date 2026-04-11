/**
 * localStorage completo para Vitest/jsdom (evita APIs parciales en algunos entornos Node).
 */
const mem: Record<string, string> = {};

const mockStorage: Storage = {
  get length() {
    return Object.keys(mem).length;
  },
  clear() {
    for (const k of Object.keys(mem)) delete mem[k];
  },
  getItem(key: string) {
    return mem[key] ?? null;
  },
  key(index: number) {
    const keys = Object.keys(mem);
    return keys[index] ?? null;
  },
  removeItem(key: string) {
    delete mem[key];
  },
  setItem(key: string, value: string) {
    mem[key] = value;
  },
};

Object.defineProperty(globalThis, 'localStorage', {
  value: mockStorage,
  configurable: true,
  writable: true,
});
