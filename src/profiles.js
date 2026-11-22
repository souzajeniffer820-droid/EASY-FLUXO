import {
  LIFE_MODES,
  CONTRACEPTIVES,
  HEALTH_CONDITIONS,
  BREASTFEEDING,
  DAILY_CATEGORIES,
  LH_OPTIONS,
  CONTRACTION_INTENSITIES,
} from './data';
import { formatDateKey, addDays, parseDateKey } from './utils';

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MODE_IDS = new Set(LIFE_MODES.map((m) => m.id));
const METHOD_IDS = new Set(CONTRACEPTIVES.map((c) => c.id));
const CONDITION_IDS = new Set(HEALTH_CONDITIONS.map((c) => c.id));
const BREASTFEEDING_IDS = new Set(BREASTFEEDING.map((b) => b.id));
const CATEGORY_KEYS = new Set(DAILY_CATEGORIES.map((c) => c.key));
const TEST_OPTIONS = new Set(LH_OPTIONS);
const INTENSITIES = new Set(CONTRACTION_INTENSITIES);

export const MAX_LOG_DAYS = 20000;

export function isDateKey(value) {
  if (typeof value !== 'string' || !DATE_KEY_RE.test(value)) return false;
  const date = parseDateKey(value);
  if (Number.isNaN(date.getTime())) return false;
  return formatDateKey(date) === value;
}

export function createProfile(id, name = 'Meu perfil') {
  return {
    id: String(id),
    name,
    heightCm: '',
    lifeMode: 'cycle',
    contraceptive: 'none',
    vasectomyConfirmed: false,
    conditions: [],
    defaultCycleLength: 28,
    defaultPeriodLength: 5,
    lastPeriodStart: null,
    postpartumDate: formatDateKey(addDays(new Date(), -30)),
    breastfeeding: 'exclusive',
    pregnancyLMP: formatDateKey(addDays(new Date(), -90)),
    logs: {},
    contractions: [],
    onboarded: false,
  };
}

function cleanString(value, maxLength = 160) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function cleanNumberString(value) {
  if (value === undefined || value === null || value === '') return '';
  const number = Number(String(value).replace(',', '.'));
  return Number.isFinite(number) && number > 0 ? String(number) : '';
}

function clampInt(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function cleanStringList(value, maxItems = 30) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => cleanString(item)).filter(Boolean))].slice(0, maxItems);
}

export function normalizeLogEntry(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

  const entry = {};

  CATEGORY_KEYS.forEach((key) => {
    const list = cleanStringList(raw[key]);
    if (list.length) entry[key] = list;
  });

  const tests = cleanStringList(raw.tests, 20).filter((item) => TEST_OPTIONS.has(item));
  if (tests.length) entry.tests = tests;

  if (raw.painScale !== undefined && raw.painScale !== null && raw.painScale !== '') {
    const pain = Number(raw.painScale);
    if (Number.isFinite(pain)) entry.painScale = Math.min(10, Math.max(0, Math.round(pain)));
  }

  ['bbt', 'weight'].forEach((key) => {
    const value = cleanNumberString(raw[key]);
    if (value) entry[key] = value;
  });

  const notes = cleanString(raw.notes, 5000);
  if (notes) entry.notes = notes;

  return entry;
}

function normalizeContraction(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const startTimestamp = Number(raw.startTimestamp);
  if (!Number.isFinite(startTimestamp) || startTimestamp <= 0) return null;

  const durationSec = Math.max(0, Math.round(Number(raw.durationSec) || 0));
  const intervalRaw = Number(raw.intervalSec);

  return {
    id: cleanString(raw.id, 40) || String(startTimestamp),
    date: isDateKey(raw.date) ? raw.date : formatDateKey(new Date(startTimestamp)),
    timeStr:
      cleanString(raw.timeStr, 20) ||
      new Date(startTimestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    startTimestamp,
    durationSec,
    intervalSec: Number.isFinite(intervalRaw) && intervalRaw > 0 ? Math.round(intervalRaw) : null,
    intensity: INTENSITIES.has(raw.intensity) ? raw.intensity : 'Moderada',
  };
}

export function normalizeProfile(raw, fallbackId = 'p1') {
  const base = createProfile(fallbackId);

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;

  const logs = {};
  if (raw.logs && typeof raw.logs === 'object' && !Array.isArray(raw.logs)) {
    Object.entries(raw.logs)
      .filter(([key]) => isDateKey(key))
      .slice(0, MAX_LOG_DAYS)
      .forEach(([key, value]) => {
        const entry = normalizeLogEntry(value);
        if (Object.keys(entry).length) logs[key] = entry;
      });
  }

  const contractions = Array.isArray(raw.contractions)
    ? raw.contractions
        .map(normalizeContraction)
        .filter(Boolean)
        .sort((a, b) => b.startTimestamp - a.startTimestamp)
        .slice(0, 500)
    : [];

  const hasLogs = Object.keys(logs).length > 0;

  return {
    ...base,
    id: cleanString(raw.id, 60) || base.id,
    name: cleanString(raw.name, 80) || base.name,
    heightCm: cleanNumberString(raw.heightCm),
    lifeMode: MODE_IDS.has(raw.lifeMode) ? raw.lifeMode : base.lifeMode,
    contraceptive: METHOD_IDS.has(raw.contraceptive) ? raw.contraceptive : base.contraceptive,
    vasectomyConfirmed: raw.vasectomyConfirmed === true,
    conditions: Array.isArray(raw.conditions)
      ? [...new Set(raw.conditions.filter((condition) => CONDITION_IDS.has(condition)))]
      : [],
    defaultCycleLength: clampInt(raw.defaultCycleLength, 15, 120, base.defaultCycleLength),
    defaultPeriodLength: clampInt(raw.defaultPeriodLength, 1, 20, base.defaultPeriodLength),
    lastPeriodStart: isDateKey(raw.lastPeriodStart) ? raw.lastPeriodStart : null,
    postpartumDate: isDateKey(raw.postpartumDate) ? raw.postpartumDate : base.postpartumDate,
    breastfeeding: BREASTFEEDING_IDS.has(raw.breastfeeding)
      ? raw.breastfeeding
      : base.breastfeeding,
    pregnancyLMP: isDateKey(raw.pregnancyLMP) ? raw.pregnancyLMP : base.pregnancyLMP,
    logs,
    contractions,
    onboarded: raw.onboarded === true || hasLogs,
  };
}

export function normalizeProfiles(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const profiles = {};
  Object.entries(raw).forEach(([key, value]) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const profile = normalizeProfile(value, key);
    profiles[profile.id] = profile;
  });

  return Object.keys(profiles).length ? profiles : null;
}

export function looksLikeProfile(value) {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    ('logs' in value || 'lifeMode' in value || 'name' in value || 'contraceptive' in value)
  );
}

export function mergeProfiles(current, imported) {
  const merged = { ...current };

  Object.entries(imported).forEach(([id, incoming]) => {
    const existing = merged[id];
    if (!existing) {
      merged[id] = incoming;
      return;
    }

    const seen = new Set();
    const contractions = [...(incoming.contractions || []), ...(existing.contractions || [])]
      .filter((item) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      })
      .sort((a, b) => b.startTimestamp - a.startTimestamp)
      .slice(0, 500);

    merged[id] = {
      ...existing,
      ...incoming,
      logs: { ...(existing.logs || {}), ...(incoming.logs || {}) },
      contractions,
      onboarded: true,
    };
  });

  return merged;
}
