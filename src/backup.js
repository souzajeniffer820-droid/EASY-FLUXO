import { normalizeProfiles, looksLikeProfile } from './profiles';

export const BACKUP_APP = 'ciclolivre';
export const BACKUP_VERSION = 1;
export const BACKUP_MAX_BYTES = 15 * 1024 * 1024;

export function createBackup(profiles, activeProfileId) {
  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    activeProfileId: activeProfileId || null,
    profiles,
  };
}

export function serializeBackup(profiles, activeProfileId) {
  return JSON.stringify(createBackup(profiles, activeProfileId), null, 2);
}

export function backupSummary(profiles) {
  const list = Object.values(profiles || {});
  const logDays = list.reduce((total, profile) => total + Object.keys(profile.logs || {}).length, 0);
  return { profiles: list.length, logDays };
}

export function parseBackup(input) {
  let raw = input;

  if (typeof input === 'string') {
    if (!input.trim()) return { ok: false, error: 'O conteúdo do backup está vazio.' };
    if (input.length > BACKUP_MAX_BYTES) {
      return { ok: false, error: 'O backup é grande demais para ser importado.' };
    }
    try {
      raw = JSON.parse(input);
    } catch {
      return { ok: false, error: 'O arquivo não é um JSON válido.' };
    }
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Formato de backup não reconhecido.' };
  }

  let profilesSource = raw;
  let activeProfileId = null;
  let exportedAt = null;

  if (raw.profiles && typeof raw.profiles === 'object' && !Array.isArray(raw.profiles)) {
    if (raw.app && raw.app !== BACKUP_APP) {
      return { ok: false, error: 'Este backup não foi criado pelo CicloLivre.' };
    }
    if (Number(raw.version) > BACKUP_VERSION) {
      return {
        ok: false,
        error: 'Este backup foi criado por uma versão mais nova do app. Atualize o CicloLivre.',
      };
    }
    profilesSource = raw.profiles;
    activeProfileId = typeof raw.activeProfileId === 'string' ? raw.activeProfileId : null;
    exportedAt = typeof raw.exportedAt === 'string' ? raw.exportedAt : null;
  }

  const sourceValues = Object.values(profilesSource);
  if (!sourceValues.length || !sourceValues.some(looksLikeProfile)) {
    return { ok: false, error: 'Nenhum perfil válido foi encontrado no backup.' };
  }

  const profiles = normalizeProfiles(profilesSource);
  if (!profiles) {
    return { ok: false, error: 'Nenhum perfil válido foi encontrado no backup.' };
  }

  if (!activeProfileId || !profiles[activeProfileId]) {
    activeProfileId = Object.keys(profiles)[0];
  }

  return {
    ok: true,
    profiles,
    activeProfileId,
    exportedAt,
    summary: backupSummary(profiles),
  };
}
