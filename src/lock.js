const LOCK_KEY = 'ciclolivre_lock_v1';

export const PIN_LENGTH = 4;
export const MAX_ATTEMPTS = 5;
export const LOCK_TIMEOUT_MS = 60 * 1000;

const EMPTY_CONFIG = { enabled: false, salt: null, hash: null };

export function readLockConfig() {
  try {
    const raw = localStorage.getItem(LOCK_KEY);
    if (!raw) return EMPTY_CONFIG;
    const parsed = JSON.parse(raw);
    if (parsed?.enabled && typeof parsed.salt === 'string' && typeof parsed.hash === 'string') {
      return { enabled: true, salt: parsed.salt, hash: parsed.hash };
    }
  } catch {
    /* armazenamento indisponível ou conteúdo inválido */
  }
  return EMPTY_CONFIG;
}

function writeLockConfig(config) {
  try {
    if (!config?.enabled) {
      localStorage.removeItem(LOCK_KEY);
    } else {
      localStorage.setItem(
        LOCK_KEY,
        JSON.stringify({ enabled: true, salt: config.salt, hash: config.hash })
      );
    }
    return true;
  } catch {
    return false;
  }
}

export function isValidPin(pin) {
  return typeof pin === 'string' && new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin);
}

function toHex(bytes) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function fallbackHash(input) {
  // FNV-1a duplo: usado apenas quando Web Crypto não está disponível (ex.: HTTP fora de localhost).
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ code, 2246822519) >>> 0;
  }
  return `fnv-${h1.toString(16)}${h2.toString(16)}`;
}

async function hashPin(pin, salt) {
  const input = `${salt}:${pin}`;
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(input)
    );
    return `sha256-${toHex(digest)}`;
  }
  return fallbackHash(input);
}

function randomSalt() {
  if (globalThis.crypto?.getRandomValues) {
    return toHex(globalThis.crypto.getRandomValues(new Uint8Array(16)));
  }
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
}

export async function enablePin(pin) {
  if (!isValidPin(pin)) {
    return { ok: false, error: `Use exatamente ${PIN_LENGTH} dígitos.` };
  }
  const salt = randomSalt();
  const hash = await hashPin(pin, salt);
  if (!writeLockConfig({ enabled: true, salt, hash })) {
    return { ok: false, error: 'Não foi possível salvar o PIN neste dispositivo.' };
  }
  return { ok: true };
}

export async function verifyPin(pin, config) {
  if (!isValidPin(pin)) return false;
  const current = config || readLockConfig();
  if (!current.enabled) return true;
  return (await hashPin(pin, current.salt)) === current.hash;
}

export async function disablePin(pin) {
  const current = readLockConfig();
  if (!current.enabled) return { ok: true };
  if (!(await verifyPin(pin, current))) return { ok: false, error: 'PIN incorreto.' };
  writeLockConfig({ enabled: false });
  return { ok: true };
}

export { LOCK_KEY };
