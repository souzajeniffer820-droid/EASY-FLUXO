import { addDays, diffDays, formatDateKey, parseDateKey } from './utils';

/**
 * Estimativas de ciclo exibidas na tela inicial.
 *
 * O cálculo é determinístico e baseado em duas referências:
 * 1. duração média real do ciclo (analytics.avgCycleLength, já calculada no app);
 * 2. fase lútea de ~14 dias, usada para estimar a ovulação a partir da próxima
 *    menstruação (a fase lútea é a parte mais estável do ciclo).
 *
 * Não há probabilidade inventada: o app mostra uma data estimada, uma janela
 * (margem de erro conforme a variação dos ciclos registrados) e um nível de
 * confiança que depende da quantidade e da regularidade dos ciclos.
 */

export const LUTEAL_PHASE_DAYS = 14;
export const FERTILE_DAYS_BEFORE_OVULATION = 5;
export const FERTILE_DAYS_AFTER_OVULATION = 1;

const CONFIDENCE_META = {
  alta: {
    level: 'alta',
    label: 'Confiança alta',
    className: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  media: {
    level: 'media',
    label: 'Confiança média',
    className: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  baixa: {
    level: 'baixa',
    label: 'Confiança baixa',
    className: 'bg-stone-100 text-stone-600 border-stone-200',
  },
};

const PHASES = {
  menstrual: {
    id: 'menstrual',
    label: 'Menstruação',
    className: 'bg-rose-50 text-rose-700 border-rose-200',
  },
  folicular: {
    id: 'folicular',
    label: 'Fase folicular',
    className: 'bg-sky-50 text-sky-700 border-sky-200',
  },
  fertil: {
    id: 'fertil',
    label: 'Janela fértil',
    className: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  lutea: {
    id: 'lutea',
    label: 'Fase lútea',
    className: 'bg-violet-50 text-violet-700 border-violet-200',
  },
  estendido: {
    id: 'estendido',
    label: 'Ciclo além da média',
    className: 'bg-amber-50 text-amber-700 border-amber-200',
  },
};

export function confidenceMeta(level) {
  return CONFIDENCE_META[level] || CONFIDENCE_META.baixa;
}

export function phaseMeta(id) {
  return PHASES[id] || null;
}

function blockedMessage(profile) {
  const conditions = profile.conditions || [];

  if (profile.lifeMode === 'pregnant') {
    return 'Na gestação não há menstruação nem ovulação para prever.';
  }
  if (profile.lifeMode === 'postpartum') {
    return 'No puerpério a ovulação pode voltar antes da primeira menstruação, então não há previsão confiável.';
  }
  if (profile.contraceptive === 'continuous') {
    return 'Métodos hormonais contínuos costumam suprimir a ovulação e o sangramento é de privação.';
  }
  if (conditions.includes('chemo')) {
    return 'Durante o tratamento o ciclo pode estar em pausa.';
  }
  if (conditions.includes('hysterectomy')) {
    return 'Sem útero não há menstruação para servir de referência.';
  }
  return null;
}

function assessConfidence(profile, analytics) {
  const conditions = profile.conditions || [];
  const completedCycles = (analytics.cycles || []).filter((c) => c.cycleLength).length;
  const variation = analytics.variation || 0;
  const avg = analytics.avgCycleLength;

  if (!analytics.hasRealData) {
    return {
      ...CONFIDENCE_META.baixa,
      note: `Ainda sem histórico: usando a duração padrão de ${avg} dias do seu perfil.`,
    };
  }

  if (profile.lifeMode === 'perimenopause') {
    return {
      ...CONFIDENCE_META.baixa,
      note: 'Na perimenopausa os intervalos variam muito; trate como referência aproximada.',
    };
  }

  if (conditions.includes('pcos')) {
    return {
      ...CONFIDENCE_META.baixa,
      note: 'Com SOP os ciclos podem ser longos e imprevisíveis; a data é só uma referência.',
    };
  }

  if (completedCycles >= 3 && variation <= 3) {
    return {
      ...CONFIDENCE_META.alta,
      note: `${completedCycles} ciclos completos, média de ${avg} dias e variação de ${variation} dia(s).`,
    };
  }

  if (completedCycles >= 2 && variation <= 7) {
    return {
      ...CONFIDENCE_META.media,
      note: `${completedCycles} ciclos completos, média de ${avg} dias e variação de ${variation} dia(s).`,
    };
  }

  return {
    ...CONFIDENCE_META.baixa,
    note: `${completedCycles} ciclo(s) completo(s), variação de ${variation} dia(s): ainda há pouca base para estimar.`,
  };
}

function currentPhase(cycleDay, cycleLength, avgPeriodLength, todayKey, fertileWindow) {
  if (fertileWindow && todayKey >= fertileWindow.startKey && todayKey <= fertileWindow.endKey) {
    return PHASES.fertil;
  }
  if (cycleDay <= Math.max(1, avgPeriodLength)) return PHASES.menstrual;
  if (cycleDay > cycleLength) return PHASES.estendido;
  if (fertileWindow && todayKey < fertileWindow.startKey) return PHASES.folicular;
  return PHASES.lutea;
}

export function computeCycleForecast(profile, analytics, today = new Date()) {
  const empty = {
    status: 'empty',
    message: null,
    cycleDay: null,
    phase: null,
    nextPeriod: null,
    ovulation: null,
    fertileWindow: null,
    confidence: null,
  };

  if (!profile || !analytics) {
    return { ...empty, message: 'Ainda não há dados suficientes para prever o ciclo.' };
  }

  const blocked = blockedMessage(profile);
  if (blocked) return { ...empty, status: 'blocked', message: blocked };

  if (!analytics.lastPeriodStart) {
    return {
      ...empty,
      message:
        'Registre o primeiro dia de fluxo para ver a previsão da próxima menstruação e da ovulação.',
    };
  }

  const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const todayKey = formatDateKey(todayDate);
  const lastStart = parseDateKey(analytics.lastPeriodStart);

  const cycleLength = Math.min(99, Math.max(15, Math.round(analytics.avgCycleLength || 28)));
  const avgPeriodLength = Math.max(1, Math.round(analytics.avgPeriodLength || 5));
  const cycleDay = Math.max(1, diffDays(lastStart, todayDate) + 1);

  const spread = analytics.hasRealData
    ? Math.max(1, Math.min(7, Math.ceil((analytics.variation || 0) / 2)))
    : 3;

  const predictedStart = addDays(lastStart, cycleLength);
  const periodWindowStart = addDays(predictedStart, -spread);
  const periodWindowEnd = addDays(predictedStart, spread);

  const ovulationDate = addDays(predictedStart, -LUTEAL_PHASE_DAYS);
  const ovulationSpread = spread >= 3 ? 2 : 1;
  const ovulationWindowStart = addDays(ovulationDate, -ovulationSpread);
  const ovulationWindowEnd = addDays(ovulationDate, ovulationSpread);

  const fertileStart = addDays(ovulationWindowStart, -FERTILE_DAYS_BEFORE_OVULATION);
  const fertileEnd = addDays(ovulationWindowEnd, FERTILE_DAYS_AFTER_OVULATION);

  const toKey = formatDateKey;
  const fertileWindow = {
    startKey: toKey(fertileStart),
    endKey: toKey(fertileEnd),
    containsToday: todayKey >= toKey(fertileStart) && todayKey <= toKey(fertileEnd),
  };

  return {
    status: 'ready',
    message: null,
    cycleDay,
    phase: currentPhase(cycleDay, cycleLength, avgPeriodLength, todayKey, fertileWindow),
    nextPeriod: {
      startKey: toKey(predictedStart),
      daysUntil: diffDays(todayDate, predictedStart),
      windowStartKey: toKey(periodWindowStart),
      windowEndKey: toKey(periodWindowEnd),
    },
    ovulation: {
      dateKey: toKey(ovulationDate),
      daysUntil: diffDays(todayDate, ovulationDate),
      windowStartKey: toKey(ovulationWindowStart),
      windowEndKey: toKey(ovulationWindowEnd),
    },
    fertileWindow,
    confidence: assessConfidence(profile, analytics),
  };
}
