import { useState, useEffect, useMemo, useRef } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import {
  Calendar as CalendarIcon,
  Baby,
  Droplets,
  Heart,
  Sparkles,
  FileText,
  BookOpen,
  User,
  Plus,
  X,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Play,
  Square,
  RotateCcw,
  Scale,
  AlertCircle,
  Info,
  Copy,
  CheckCircle2,
  ShieldCheck,
  ShieldAlert,
  Stethoscope,
  HelpCircle,
  Smartphone,
  Search,
  Trash2,
  Share2,
  Sun,
  Download,
  Upload,
  Lock,
  KeyRound,
  TrendingUp,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';

import {
  LIFE_MODES,
  CONTRACEPTIVES,
  HEALTH_CONDITIONS,
  ARTICLES,
  DAILY_CATEGORIES,
  BREASTFEEDING,
  LH_OPTIONS,
  CONTRACTION_INTENSITIES,
} from './data';

import {
  formatDateKey,
  parseDateKey,
  addDays,
  diffDays,
  calculateBMI,
  formatBR,
  monthTitle,
  secondsToClock,
  nextCycleStart,
} from './utils';

import { createProfile, mergeProfiles, normalizeProfiles } from './profiles';
import { readLockConfig, LOCK_TIMEOUT_MS, PIN_LENGTH } from './lock';
import { copyText } from './clipboard';
import LockScreen from './LockScreen';
import PinSheet from './PinSheet';
import WelcomeSheet from './WelcomeSheet';
import { ExportSheet, ImportSheet } from './BackupSheets';
import { Sparkline } from './charts';
import { computeCycleForecast } from './forecast';

const STORAGE_KEY = 'ciclolivre_v3_profiles';
const ACTIVE_KEY = 'ciclolivre_v3_active';
const CORRUPT_KEY = 'ciclolivre_v3_corrupted_backup';
const PERIOD_FLOWS = ['Leve', 'Moderado', 'Intenso', 'Coágulos'];

function clampOptionalInteger(value, min, max) {
  const parsed = Number.parseInt(String(value).trim(), 10);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(max, Math.max(min, parsed));
}

/* ------------------------------------------------------------------ */
/* Dados iniciais                                                      */
/* ------------------------------------------------------------------ */

function buildDemoData() {
  const today = new Date();
  const logs = {};

  [0, 1, 2, 3, 4].forEach((offset, idx) => {
    logs[formatDateKey(addDays(today, -62 + offset))] = {
      flow: idx === 1 ? ['Intenso'] : idx < 3 ? ['Moderado'] : ['Leve'],
      pains: idx === 1 ? ['Cólica leve'] : [],
      feelings: ['Calma'],
    };
  });
  [0, 1, 2, 3].forEach((offset, idx) => {
    logs[formatDateKey(addDays(today, -33 + offset))] = {
      flow: idx < 2 ? ['Moderado'] : ['Leve'],
      feelings: ['Sensível'],
    };
  });
  [0, 1, 2, 3, 4].forEach((offset, idx) => {
    logs[formatDateKey(addDays(today, -5 + offset))] = {
      flow: idx === 1 ? ['Moderado'] : ['Leve'],
      weight: idx === 0 ? '64.5' : undefined,
      feelings: idx === 0 ? ['Com energia'] : ['Calma'],
    };
  });

  return {
    ...createProfile('p1', 'Perfil 1 (Principal)'),
    heightCm: '165',
    logs,
  };
}

function loadProfiles() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return { profiles: { p1: createProfile('p1') }, error: null };

    let parsed;
    try {
      parsed = JSON.parse(saved);
    } catch {
      try {
        localStorage.setItem(CORRUPT_KEY, saved);
      } catch {
        /* sem espaço para preservar a cópia */
      }
      return {
        profiles: { p1: createProfile('p1') },
        error:
          'Não foi possível ler os dados salvos. Uma cópia do conteúdo corrompido foi preservada no dispositivo.',
      };
    }

    const profiles = normalizeProfiles(parsed);
    if (!profiles) {
      return {
        profiles: { p1: createProfile('p1') },
        error: 'Os dados salvos estavam em um formato não reconhecido.',
      };
    }

    return { profiles, error: null };
  } catch {
    return {
      profiles: { p1: createProfile('p1') },
      error: 'Não foi possível acessar o armazenamento local do dispositivo.',
    };
  }
}

/* ------------------------------------------------------------------ */
/* Cálculos                                                            */
/* ------------------------------------------------------------------ */

function computeCycleAnalytics(profile) {
  const logs = profile.logs || {};
  const periodDays = Object.keys(logs)
    .filter((k) => (logs[k]?.flow || []).some((f) => PERIOD_FLOWS.includes(f)))
    .sort();

  if (periodDays.length === 0) {
    return {
      cycles: [],
      avgCycleLength: profile.defaultCycleLength ?? null,
      avgPeriodLength: profile.defaultPeriodLength ?? null,
      variation: 0,
      lastPeriodStart: profile.lastPeriodStart || null,
      hasRealData: false,
    };
  }

  const episodes = [];
  let currentEpisode = [periodDays[0]];

  for (let i = 1; i < periodDays.length; i += 1) {
    const gap = diffDays(parseDateKey(periodDays[i - 1]), parseDateKey(periodDays[i]));
    if (gap <= 2) {
      currentEpisode.push(periodDays[i]);
    } else {
      episodes.push(currentEpisode);
      currentEpisode = [periodDays[i]];
    }
  }
  episodes.push(currentEpisode);

  const parsedCycles = episodes.map((ep, index) => {
    const start = ep[0];
    const end = ep[ep.length - 1];
    const periodLength = diffDays(parseDateKey(start), parseDateKey(end)) + 1;
    let cycleLength = null;
    if (index < episodes.length - 1) {
      cycleLength = diffDays(parseDateKey(start), parseDateKey(episodes[index + 1][0]));
    }
    return { start, end, periodLength, cycleLength };
  });

  const completedLengths = parsedCycles
    .map((c) => c.cycleLength)
    .filter((len) => len !== null && len >= 15 && len <= 90);

  const avgCycleLength =
    completedLengths.length > 0
      ? Math.round(completedLengths.reduce((a, b) => a + b, 0) / completedLengths.length)
      : (profile.defaultCycleLength ?? null);

  const avgPeriodLength =
    parsedCycles.length > 0
      ? Math.round(parsedCycles.reduce((acc, c) => acc + c.periodLength, 0) / parsedCycles.length)
      : (profile.defaultPeriodLength ?? null);

  const variation =
    completedLengths.length > 1 ? Math.max(...completedLengths) - Math.min(...completedLengths) : 0;

  return {
    cycles: parsedCycles,
    avgCycleLength,
    avgPeriodLength,
    variation,
    lastPeriodStart: parsedCycles[parsedCycles.length - 1]?.start || null,
    hasRealData: true,
  };
}

function computeTodayStatus(profile, analytics) {
  const today = new Date();
  const conditions = profile.conditions || [];
  const hasHysterectomy = conditions.includes('hysterectomy');
  const hasPCOS = conditions.includes('pcos');
  const hasChemo = conditions.includes('chemo');
  const methodObj = CONTRACEPTIVES.find((c) => c.id === profile.contraceptive) || CONTRACEPTIVES[0];

  if (profile.lifeMode === 'pregnant') {
    const lmp = parseDateKey(profile.pregnancyLMP || formatDateKey(addDays(today, -120)));
    const totalDays = Math.max(0, diffDays(lmp, today));
    const weeks = Math.floor(totalDays / 7);
    const days = totalDays % 7;
    const dueDate = addDays(lmp, 280);
    const babySizes = [
      'Semente de papoula',
      'Framboesa',
      'Limão siciliano',
      'Abacate',
      'Manga',
      'Espiga de milho',
      'Berinjela',
      'Abacaxi',
      'Melancia baby',
    ];
    const sizeIdx = Math.min(babySizes.length - 1, Math.floor(weeks / 5));
    const trimester = weeks < 13 ? '1º trimestre' : weeks < 28 ? '2º trimestre' : '3º trimestre';
    return {
      badge: 'Gestação Ativa',
      badgeColor: 'bg-pink-100 text-pink-800',
      headline: `${weeks} semanas e ${days} dias`,
      subtext: `Data provável do parto: ${dueDate.toLocaleDateString('pt-BR')} • Tamanho: ~${babySizes[sizeIdx]}`,
      phase: 'pregnant',
      extra: trimester,
      progress: Math.min(100, Math.round((totalDays / 280) * 100)),
    };
  }

  if (profile.lifeMode === 'postpartum') {
    const birth = parseDateKey(profile.postpartumDate || formatDateKey(addDays(today, -30)));
    const daysSince = Math.max(0, diffDays(birth, today));
    const weeksSince = Math.floor(daysSince / 7);
    const bfLabels = {
      exclusive: 'Amamentação exclusiva (prolactina pode adiar a ovulação)',
      mixed: 'Amamentação mista',
      formula: 'Fórmula infantil',
    };
    return {
      badge: 'Modo Pós-Parto (Puerpério)',
      badgeColor: 'bg-teal-100 text-teal-800',
      headline: `${weeksSince} semanas pós-parto (${daysSince} dias)`,
      subtext: `Previsões rígidas pausadas • ${bfLabels[profile.breastfeeding] || ''}`,
      phase: 'postpartum',
    };
  }

  if (hasChemo) {
    return {
      badge: 'Em Tratamento / Quimioterapia',
      badgeColor: 'bg-purple-100 text-purple-800',
      headline: 'Ciclo em pausa esperada',
      subtext:
        'Ausência de menstruação é normal durante o protocolo. Foco em bem-estar e sintomas.',
      phase: 'paused',
    };
  }

  if (hasHysterectomy) {
    return {
      badge: 'Pós-Histerectomia',
      badgeColor: 'bg-indigo-100 text-indigo-800',
      headline: 'Acompanhamento Hormonal & Bem-Estar',
      subtext:
        'Sangramento ocultado. Monitore humor, energia e sinais ovarianos sem alertas de atraso.',
      phase: 'hysterectomy',
    };
  }

  if (profile.contraceptive === 'continuous') {
    return {
      badge: 'Método Hormonal Contínuo',
      badgeColor: 'bg-sky-100 text-sky-800',
      headline: 'Sem previsão de menstruação',
      subtext:
        'Alertas de atraso desativados. Registre escapes (spotting) ou sintomas hormonais.',
      phase: 'continuous',
    };
  }

  if (!analytics.lastPeriodStart) {
    return {
      badge: 'Primeiros passos',
      badgeColor: 'bg-stone-100 text-stone-700',
      headline: 'Registre seu primeiro fluxo',
      subtext:
        'Quando você marcar um dia de menstruação, o app calcula seu dia do ciclo e as previsões com base no seu histórico real.',
      phase: 'empty',
    };
  }

  if (profile.lifeMode === 'perimenopause') {
    const lastStart = parseDateKey(analytics.lastPeriodStart);
    const cycleDay = Math.max(1, diffDays(lastStart, today) + 1);
    return {
      badge: 'Perimenopausa',
      badgeColor: 'bg-amber-100 text-amber-800',
      headline: `Dia ${cycleDay} do ciclo atual`,
      subtext: 'Ciclos irregulares são esperados nesta fase — sem alertas de atraso.',
      phase: 'perimenopause',
    };
  }

  const lastStart = parseDateKey(analytics.lastPeriodStart);
  const cycleDay = Math.max(1, diffDays(lastStart, today) + 1);
  const avgLen = analytics.avgCycleLength;
  if (!Number.isFinite(Number(avgLen)) || Number(avgLen) <= 0) {
    return {
      badge: profile.lifeMode === 'ttc' ? 'Tentando Engravidar' : 'Ciclo Menstrual',
      badgeColor:
        profile.lifeMode === 'ttc'
          ? 'bg-rose-100 text-rose-800'
          : 'bg-fuchsia-100 text-fuchsia-800',
      headline: `Dia ${cycleDay} do ciclo`,
      subtext:
        'Informe a duração média do ciclo ou registre mais ciclos para receber previsões.',
      phase: 'regular',
      lastStart,
    };
  }
  const avgLenNumber = Number(avgLen);
  const ovulDay = Math.max(10, avgLenNumber - 14);
  const daysToNext = avgLenNumber - cycleDay + 1;

  let subtext = '';
  if (profile.lifeMode === 'ttc') {
    subtext =
      Math.abs(cycleDay - ovulDay) <= 2
        ? 'Alta fertilidade estimada! Registre muco cervical, LH e temperatura basal.'
        : `Janela fértil estimada perto do dia ${ovulDay} do ciclo.`;
  } else if (methodObj.hidePregnancyRisk) {
    const note =
      profile.contraceptive === 'vasectomy' && !profile.vasectomyConfirmed
        ? 'Atenção: aguardando espermograma de confirmação.'
        : 'Risco de gravidez desativado pelo método definitivo.';
    subtext = `${note} Próximo ciclo previsto em ~${Math.max(1, daysToNext)} dias.`;
  } else if (hasPCOS && cycleDay > avgLenNumber) {
    subtext = 'Ciclo alongado (comum na SOP) — alerta rígido de atraso desativado.';
  } else {
    subtext =
      daysToNext > 0
        ? `Próxima menstruação estimada em ${daysToNext} dias (média de ${avgLenNumber} dias).`
        : `Ciclo no dia ${cycleDay} (média habitual de ${avgLenNumber} dias).`;
  }

  return {
    badge: profile.lifeMode === 'ttc' ? 'Tentando Engravidar' : 'Ciclo Menstrual',
    badgeColor:
      profile.lifeMode === 'ttc' ? 'bg-rose-100 text-rose-800' : 'bg-fuchsia-100 text-fuchsia-800',
    headline: `Dia ${cycleDay} do ciclo`,
    subtext,
    phase: 'regular',
    ovulDay,
    avgLen: avgLenNumber,
    lastStart,
  };
}

function buildReportText(profile, analytics, weightHistory) {
  const modeLabel = LIFE_MODES.find((m) => m.id === profile.lifeMode)?.label || '';
  const methodLabel = CONTRACEPTIVES.find((c) => c.id === profile.contraceptive)?.label || '';
  const condLabels = (profile.conditions || [])
    .map((id) => HEALTH_CONDITIONS.find((c) => c.id === id)?.label)
    .filter(Boolean)
    .join(', ');

  let text = 'RELATÓRIO DE SAÚDE — CICLOLIVRE\n';
  text += `Perfil: ${profile.name} | Altura: ${profile.heightCm || 'Não informada'} cm\n`;
  text += `Fase atual: ${modeLabel}\n`;
  text += `Contracepção: ${methodLabel}\n`;
  if (condLabels) text += `Condições relatadas: ${condLabels}\n`;

  text += '\n--- ANÁLISE DO CICLO ---\n';
  const cycleLength = analytics.avgCycleLength;
  const periodLength = analytics.avgPeriodLength;
  text += `• Duração média do ciclo: ${cycleLength == null ? 'Não informada' : `${cycleLength} dias`}\n`;
  text += `• Duração média da menstruação: ${periodLength == null ? 'Não informada' : `${periodLength} dias`}\n`;
  text += `• Variação entre ciclos: ${analytics.variation} dias\n`;
  if (analytics.lastPeriodStart) {
    text += `• Último início de sangramento: ${formatBR(analytics.lastPeriodStart)}\n`;
  }

  if (weightHistory.length > 0) {
    const latest = weightHistory[0];
    text += '\n--- ÚLTIMO PESO & IMC ---\n';
    text += `• ${formatBR(latest.date)}: ${latest.weight} kg`;
    text += latest.bmi ? ` (IMC ${latest.bmi.value} - ${latest.bmi.label})\n` : '\n';
  }

  if (profile.lifeMode === 'pregnant' && (profile.contractions || []).length > 0) {
    text += '\n--- CONTRAÇÕES RECENTES ---\n';
    profile.contractions.slice(0, 6).forEach((c) => {
      const interval = c.intervalSec
        ? `${Math.round(c.intervalSec / 60)} min após a anterior`
        : '1º registro';
      text += `• ${c.timeStr} (${c.intensity}): duração ${c.durationSec}s | intervalo: ${interval}\n`;
    });
  }

  const recentDates = Object.keys(profile.logs || {})
    .sort()
    .reverse()
    .slice(0, 7);

  if (recentDates.length > 0) {
    text += '\n--- REGISTROS DIÁRIOS RECENTES ---\n';
    recentDates.forEach((d) => {
      const entry = profile.logs[d] || {};
      const parts = [];
      DAILY_CATEGORIES.forEach((cat) => {
        if (entry[cat.key]?.length) parts.push(`${cat.title}: ${entry[cat.key].join(', ')}`);
      });
      if (entry.tests?.length) parts.push(`Testes: ${entry.tests.join(', ')}`);
      if (entry.bbt) parts.push(`Temp. Basal: ${entry.bbt}°C`);
      if (entry.painScale) parts.push(`Dor pélvica: ${entry.painScale}/10`);
      if (entry.weight) parts.push(`Peso: ${entry.weight}kg`);
      if (entry.notes) parts.push(`Nota: ${entry.notes}`);
      if (parts.length > 0) text += `[${d}] ${parts.join(' | ')}\n`;
    });
  }

  return text;
}

function contractionAlert(list) {
  if (!list || list.length < 3) return null;
  const recent = list.slice(0, 6);
  const fast = recent.filter((c) => c.intervalSec && c.intervalSec <= 300 && c.durationSec >= 45);
  if (fast.length < 3) return null;
  const span = (recent[0].startTimestamp - recent[recent.length - 1].startTimestamp) / 60000;
  if (span < 30) return null;
  return `Padrão compatível com a regra 5-1-1: ${fast.length} contrações em intervalos de até 5 min, com duração de 1 min. Procure a maternidade.`;
}

/* ------------------------------------------------------------------ */
/* Componentes auxiliares                                              */
/* ------------------------------------------------------------------ */

function Chip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-xs px-3 py-1.5 rounded-full border transition font-medium ${
        active
          ? 'bg-rose-600 text-white border-rose-600 shadow-sm'
          : 'bg-white text-stone-600 border-stone-200 active:bg-stone-100'
      }`}
    >
      {children}
    </button>
  );
}

function SectionCard({ children, className = '' }) {
  return (
    <section
      className={`bg-white rounded-2xl border border-stone-200/80 shadow-sm p-4 ${className}`}
    >
      {children}
    </section>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-stone-500">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

const inputClass =
  'w-full text-sm border border-stone-200 rounded-xl px-3 py-2.5 bg-white text-stone-800 focus:outline-none focus:ring-2 focus:ring-rose-400';

const TREND_METRICS = [
  {
    id: 'weight',
    label: 'Peso',
    color: '#0f766e',
    unit: ' kg',
    format: (value) => Number(value).toFixed(1),
    empty: 'Registre seu peso no diário para acompanhar a evolução.',
  },
  {
    id: 'bbt',
    label: 'Temp. basal',
    color: '#c2410c',
    unit: '°C',
    format: (value) => Number(value).toFixed(1),
    empty: 'Registre a temperatura basal para enxergar o padrão do seu ciclo.',
  },
  {
    id: 'pain',
    label: 'Dor',
    color: '#be123c',
    unit: '/10',
    format: (value) => String(Math.round(Number(value))),
    empty: 'Use a escala de dor no diário para acompanhar os picos.',
  },
  {
    id: 'cycle',
    label: 'Ciclos',
    color: '#7c3aed',
    unit: ' d',
    format: (value) => String(Math.round(Number(value))),
    empty: 'Registre pelo menos dois fluxos para ver a duração dos ciclos.',
  },
];

function TrendsCard({ profile, analytics }) {
  const [metric, setMetric] = useState('weight');

  const data = useMemo(() => {
    const weight = [];
    const bbt = [];
    const pain = [];

    Object.entries(profile.logs || {})
      .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
      .forEach(([date, log]) => {
        const weightValue = parseFloat(log.weight);
        if (Number.isFinite(weightValue) && weightValue > 0) {
          weight.push({ key: `w-${date}`, date, value: weightValue });
        }

        const bbtValue = parseFloat(log.bbt);
        if (Number.isFinite(bbtValue) && bbtValue > 0) {
          bbt.push({ key: `t-${date}`, date, value: bbtValue });
        }

        if (log.painScale !== undefined && log.painScale !== null && log.painScale !== '') {
          const painValue = Number(log.painScale);
          if (Number.isFinite(painValue)) pain.push({ key: `p-${date}`, date, value: painValue });
        }
      });

    const cycle = analytics.cycles
      .filter((item) => item.cycleLength)
      .map((item) => ({ key: `c-${item.start}`, date: item.start, value: item.cycleLength }));

    return {
      weight: weight.slice(-30),
      bbt: bbt.slice(-30),
      pain: pain.slice(-30),
      cycle: cycle.slice(-12),
    };
  }, [profile.logs, analytics.cycles]);

  const points = data[metric] || [];
  const config = TREND_METRICS.find((item) => item.id === metric) || TREND_METRICS[0];
  const latest = points[points.length - 1];
  const previous = points[points.length - 2];
  const delta = latest && previous ? latest.value - previous.value : null;

  return (
    <SectionCard>
      <div className="flex items-center gap-2 mb-2">
        <TrendingUp className="w-4 h-4 text-rose-600" />
        <h3 className="text-sm font-bold text-stone-900">Tendências</h3>
      </div>

      <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-2">
        {TREND_METRICS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setMetric(item.id)}
            aria-pressed={metric === item.id}
            className={`shrink-0 text-[11px] px-2.5 py-1 rounded-full border font-medium transition ${
              metric === item.id
                ? 'bg-stone-900 text-white border-stone-900'
                : 'bg-white text-stone-600 border-stone-200'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {points.length === 0 ? (
        <p className="text-xs text-stone-500 leading-relaxed py-2">{config.empty}</p>
      ) : (
        <>
          <div className="flex items-end justify-between mb-1">
            <div>
              <p className="text-2xl font-bold text-stone-900">
                {config.format(latest.value)}
                {config.unit}
              </p>
              <p className="text-[10px] text-stone-500">último registro</p>
            </div>
            {delta !== null && (
              <span
                className={`flex items-center gap-0.5 text-[11px] font-semibold ${
                  delta > 0
                    ? 'text-rose-600'
                    : delta < 0
                      ? 'text-emerald-600'
                      : 'text-stone-400'
                }`}
              >
                {delta > 0 && <ArrowUpRight className="w-3.5 h-3.5" />}
                {delta < 0 && <ArrowDownRight className="w-3.5 h-3.5" />}
                {config.format(Math.abs(delta))}
                {config.unit}
              </span>
            )}
          </div>
          <Sparkline
            points={points}
            color={config.color}
            unit={config.unit}
            formatValue={config.format}
            ariaLabel={`Evolução de ${config.label}`}
          />
        </>
      )}

      {metric === 'bbt' && points.length > 0 && (
        <p className="text-[10px] text-stone-400 mt-2 leading-relaxed">
          A temperatura basal só é útil quando medida no mesmo horário, antes de levantar.
        </p>
      )}
    </SectionCard>
  );
}

function CycleForecastCard({ forecast }) {
  if (!forecast || forecast.status === 'blocked') return null;

  if (forecast.status !== 'ready') {
    return (
      <SectionCard>
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-4 h-4 text-rose-600" />
          <h3 className="text-sm font-bold text-stone-900">Previsão do ciclo</h3>
        </div>
        <p className="text-xs text-stone-600 leading-relaxed">{forecast.message}</p>
      </SectionCard>
    );
  }

  const { nextPeriod, ovulation, fertileWindow, confidence, phase, cycleDay } = forecast;
  const shortDate = (key) => formatBR(key, { day: '2-digit', month: '2-digit' });
  const longDate = (key) =>
    parseDateKey(key).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });

  const periodHeadline =
    nextPeriod.daysUntil === 0
      ? 'Hoje'
      : nextPeriod.daysUntil > 0
        ? `Em ${nextPeriod.daysUntil} ${nextPeriod.daysUntil === 1 ? 'dia' : 'dias'}`
        : `Atrasada há ${Math.abs(nextPeriod.daysUntil)} ${Math.abs(nextPeriod.daysUntil) === 1 ? 'dia' : 'dias'}`;

  const ovulationHeadline =
    ovulation.daysUntil === 0
      ? 'Hoje'
      : ovulation.daysUntil > 0
        ? `Em ${ovulation.daysUntil} ${ovulation.daysUntil === 1 ? 'dia' : 'dias'}`
        : 'Já passou';

  return (
    <SectionCard className="bg-gradient-to-br from-rose-50/70 via-white to-amber-50/70 border-rose-100">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-rose-600" />
          <h3 className="text-sm font-bold text-stone-900">Previsão do ciclo</h3>
        </div>
        {confidence && (
          <span
            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${confidence.className}`}
          >
            {confidence.label}
          </span>
        )}
      </div>

      {phase && (
        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-md border ${phase.className}`}>
            {phase.label}
          </span>
          <span className="text-[11px] text-stone-500">Dia {cycleDay} do ciclo</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 mt-3">
        <div className="rounded-xl bg-white/80 border border-rose-100 p-3">
          <div className="flex items-center gap-1.5 text-rose-600">
            <Droplets className="w-3.5 h-3.5" />
            <span className="text-[10px] font-semibold uppercase tracking-wide">
              Próxima menstruação
            </span>
          </div>
          <p className="mt-1 text-base font-bold text-stone-900 leading-tight">{periodHeadline}</p>
          <p className="text-[11px] text-stone-600 mt-0.5">{longDate(nextPeriod.startKey)}</p>
          <p className="text-[10px] text-stone-500 mt-1">
            Janela provável: {shortDate(nextPeriod.windowStartKey)} – {shortDate(nextPeriod.windowEndKey)}
          </p>
        </div>

        <div className="rounded-xl bg-white/80 border border-amber-100 p-3">
          <div className="flex items-center gap-1.5 text-amber-600">
            <Heart className="w-3.5 h-3.5" />
            <span className="text-[10px] font-semibold uppercase tracking-wide">
              Ovulação estimada
            </span>
          </div>
          <p className="mt-1 text-base font-bold text-stone-900 leading-tight">
            {ovulationHeadline}
          </p>
          <p className="text-[11px] text-stone-600 mt-0.5">{longDate(ovulation.dateKey)}</p>
          <p className="text-[10px] text-stone-500 mt-1">
            Janela fértil: {shortDate(fertileWindow.startKey)} – {shortDate(fertileWindow.endKey)}
          </p>
        </div>
      </div>

      {fertileWindow.containsToday && (
        <div className="mt-2 flex gap-2 p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-[11px]">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            Você está na janela fértil estimada (os ~6 dias de maior chance de concepção).
          </p>
        </div>
      )}

      {confidence?.note && (
        <p className="text-[10px] text-stone-500 mt-2 leading-relaxed">{confidence.note}</p>
      )}
      <p className="text-[10px] text-stone-400 mt-1 leading-relaxed">
        Estimativas baseadas no seu histórico. Não servem como método contraceptivo.
      </p>
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ */
/* Aba: Hoje                                                           */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Aba: Hoje                                                           */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Aba: Hoje                                                           */
/* ------------------------------------------------------------------ */

function TodayTab({
  profile,
  analytics,
  status,
  forecast,
  todayLog,
  recommendedArticle,
  latestWeight,
  onOpenLogToday,
  onOpenArticle,
  onGoCalendar,
  contractions,
  timer,
  onTimerToggle,
  intensity,
  setIntensity,
  onClearContractions,
}) {
  const todayKey = formatDateKey(new Date());
  const alert = contractionAlert(contractions);
  const loggedCount = DAILY_CATEGORIES.filter((c) => todayLog[c.key]?.length).length;
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(new Date(), i - 3));

  return (
    <div className="space-y-4">
      <SectionCard>
        <div className="flex items-center justify-between gap-2 mb-2">
          <span
            className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${status.badgeColor}`}
          >
            {status.badge}
          </span>
          <div className="flex items-center gap-1.5">
            {status.extra && (
              <span className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-pink-50 text-pink-700 border border-pink-200">
                {status.extra}
              </span>
            )}
            {profile.conditions.length > 0 && (
              <span className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 border border-purple-200">
                {profile.conditions.length} condição(ões)
              </span>
            )}
          </div>
        </div>

        <h2 className="text-2xl font-bold text-stone-900 mt-1">{status.headline}</h2>
        <p className="text-sm text-stone-600 mt-1 leading-relaxed">{status.subtext}</p>

        {typeof status.progress === 'number' && (
          <div className="mt-3">
            <div className="h-2 rounded-full bg-pink-100 overflow-hidden">
              <div
                className="h-full bg-pink-500 rounded-full transition-all"
                style={{ width: `${status.progress}%` }}
              />
            </div>
            <p className="text-[11px] text-stone-500 mt-1">{status.progress}% da gestação</p>
          </div>
        )}

        <div className="mt-4 pt-3 border-t border-stone-100 flex gap-2">
          <button
            onClick={onOpenLogToday}
            className="flex-1 bg-rose-600 active:bg-rose-700 text-white font-semibold text-sm py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 shadow-sm transition"
          >
            <Plus className="w-4 h-4" />
            Registrar Hoje
          </button>
          <button
            onClick={onGoCalendar}
            className="px-3.5 rounded-xl border border-stone-200 text-stone-600 active:bg-stone-50"
            title="Abrir calendário"
          >
            <CalendarIcon className="w-5 h-5" />
          </button>
        </div>
      </SectionCard>

      <CycleForecastCard forecast={forecast} />

      <SectionCard>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-stone-900">Sua semana</h3>
          <span className="text-[11px] text-stone-500">{loggedCount} de 14 categorias hoje</span>
        </div>
        <div className="grid grid-cols-7 gap-1">
          {weekDays.map((day) => {
            const key = formatDateKey(day);
            const log = profile.logs[key] || {};
            const isToday = key === todayKey;
            const hasFlow = (log.flow || []).some((f) => PERIOD_FLOWS.includes(f));
            const hasLog = Object.keys(log).length > 0;
            return (
              <div
                key={key}
                className={`flex flex-col items-center gap-1 py-2 rounded-xl ${
                  isToday ? 'bg-rose-50 border border-rose-200' : ''
                }`}
              >
                <span className="text-[10px] uppercase text-stone-400">
                  {day.toLocaleDateString('pt-BR', { weekday: 'narrow' })}
                </span>
                <span
                  className={`text-sm font-semibold ${
                    isToday ? 'text-rose-700' : 'text-stone-700'
                  }`}
                >
                  {day.getDate()}
                </span>
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    hasFlow ? 'bg-rose-500' : hasLog ? 'bg-amber-400' : 'bg-stone-200'
                  }`}
                />
              </div>
            );
          })}
        </div>
      </SectionCard>

      {profile.lifeMode === 'pregnant' && (
        <SectionCard className="bg-gradient-to-br from-pink-50 to-rose-50 border-pink-200">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-pink-600" />
              <h3 className="font-bold text-stone-900 text-sm">Contador de Contrações</h3>
            </div>
            <button
              onClick={() => onOpenArticle(ARTICLES.find((a) => a.id === 'contractions-511'))}
              className="text-[11px] text-pink-700 font-medium flex items-center gap-1 underline"
            >
              <HelpCircle className="w-3.5 h-3.5" /> Regra 5-1-1
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5 mb-3">
            {CONTRACTION_INTENSITIES.map((level) => (
              <button
                key={level}
                onClick={() => setIntensity(level)}
                className={`text-[11px] px-2.5 py-1 rounded-lg font-medium border transition ${
                  intensity === level
                    ? 'bg-pink-600 text-white border-pink-600'
                    : 'bg-white text-stone-700 border-pink-200'
                }`}
              >
                {level}
              </button>
            ))}
          </div>

          <div className="bg-white rounded-xl border border-pink-200 p-4 text-center">
            <p className="text-4xl font-mono font-bold text-stone-900 tabular-nums">
              {secondsToClock(timer.elapsed)}
            </p>
            <p className="text-[11px] text-stone-500 mt-1">
              {timer.running ? 'Contração em andamento…' : 'Toque para iniciar a cronometragem'}
            </p>
            <button
              onClick={onTimerToggle}
              className={`mt-3 w-full py-2.5 rounded-xl font-semibold text-sm text-white flex items-center justify-center gap-2 ${
                timer.running ? 'bg-stone-800 active:bg-stone-900' : 'bg-pink-600 active:bg-pink-700'
              }`}
            >
              {timer.running ? (
                <>
                  <Square className="w-4 h-4" /> Finalizar contração
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" /> Iniciar contração
                </>
              )}
            </button>
          </div>

          {alert && (
            <div className="mt-3 flex gap-2 p-3 rounded-xl bg-rose-100 border border-rose-300 text-rose-900 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <p className="leading-relaxed">{alert}</p>
            </div>
          )}

          {contractions.length > 0 && (
            <div className="mt-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-semibold text-stone-600">
                  {contractions.length} registro(s)
                </span>
                <button
                  onClick={onClearContractions}
                  className="text-[11px] text-stone-500 flex items-center gap-1"
                >
                  <RotateCcw className="w-3 h-3" /> Limpar
                </button>
              </div>
              <div className="space-y-1 max-h-40 overflow-y-auto no-scrollbar">
                {contractions.slice(0, 8).map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between text-[11px] bg-white/80 rounded-lg px-2.5 py-1.5 border border-pink-100"
                  >
                    <span className="font-medium text-stone-700">{c.timeStr}</span>
                    <span className="text-stone-500">{c.intensity}</span>
                    <span className="text-stone-600">{c.durationSec}s</span>
                    <span className="text-stone-400">
                      {c.intervalSec ? `${Math.round(c.intervalSec / 60)} min` : '1ª'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </SectionCard>
      )}

      <SectionCard>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-stone-900">Resumo do ciclo</h3>
          <span className="text-[11px] text-stone-500">
            {analytics.hasRealData
              ? 'Baseado no seu histórico'
              : analytics.avgCycleLength != null || analytics.avgPeriodLength != null
                ? 'Valores padrão'
                : 'Não informado'}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-stone-50 border border-stone-100 p-2.5 text-center">
            <p className="text-xl font-bold text-stone-900">{analytics.avgCycleLength ?? '—'}</p>
            <p className="text-[10px] text-stone-500 mt-0.5">dias de ciclo</p>
          </div>
          <div className="rounded-xl bg-stone-50 border border-stone-100 p-2.5 text-center">
            <p className="text-xl font-bold text-stone-900">{analytics.avgPeriodLength ?? '—'}</p>
            <p className="text-[10px] text-stone-500 mt-0.5">dias de fluxo</p>
          </div>
          <div className="rounded-xl bg-stone-50 border border-stone-100 p-2.5 text-center">
            <p className="text-xl font-bold text-stone-900">±{analytics.variation}</p>
            <p className="text-[10px] text-stone-500 mt-0.5">variação</p>
          </div>
        </div>
      </SectionCard>

      <SectionCard>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Scale className="w-4 h-4 text-teal-600" />
            <h3 className="text-sm font-bold text-stone-900">Peso & IMC</h3>
          </div>
          <span className="text-[11px] text-stone-500">
            {latestWeight
              ? formatBR(latestWeight.date, { day: '2-digit', month: 'short' })
              : 'sem registro'}
          </span>
        </div>

        {latestWeight ? (
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-stone-50 border border-stone-100 p-3">
              <p className="text-2xl font-bold text-stone-900">
                {latestWeight.weight}
                <span className="text-sm font-medium text-stone-500"> kg</span>
              </p>
              <p className="text-[10px] text-stone-500 mt-0.5">último peso</p>
            </div>
            <div
              className={`rounded-xl border p-3 ${
                latestWeight.bmi ? latestWeight.bmi.color : 'bg-stone-50 border-stone-100'
              }`}
            >
              <p className="text-2xl font-bold">
                {latestWeight.bmi ? latestWeight.bmi.value : '—'}
              </p>
              <p className="text-[10px] mt-0.5">
                {latestWeight.bmi ? latestWeight.bmi.label : 'Informe sua altura no Perfil'}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-xs text-stone-500 leading-relaxed">
            Registre seu peso no diário para calcular o IMC automaticamente.
          </p>
        )}

        <button
          type="button"
          onClick={onOpenLogToday}
          className="mt-2 w-full text-xs font-semibold py-2.5 rounded-xl border border-stone-200 text-stone-700 flex items-center justify-center gap-2 active:bg-stone-50"
        >
          <Plus className="w-3.5 h-3.5" /> Registrar peso
        </button>
      </SectionCard>

      <SectionCard>
        <div className="flex items-center gap-2 mb-2">
          <BookOpen className="w-4 h-4 text-rose-600" />
          <h3 className="text-sm font-bold text-stone-900">Recomendado para você</h3>
        </div>
        <button onClick={() => onOpenArticle(recommendedArticle)} className="text-left w-full">
          <p className="text-[11px] font-semibold text-rose-600">
            {recommendedArticle.category} • {recommendedArticle.readTime}
          </p>
          <p className="text-sm font-semibold text-stone-900 mt-1 leading-snug">
            {recommendedArticle.title}
          </p>
          <p className="text-xs text-stone-600 mt-1 leading-relaxed line-clamp-3">
            {recommendedArticle.tldr}
          </p>
          <span className="inline-flex items-center gap-1 text-xs font-medium text-rose-600 mt-2">
            Ler conteúdo <ChevronRight className="w-3.5 h-3.5" />
          </span>
        </button>
      </SectionCard>

      <p className="text-[10px] text-center text-stone-400 leading-relaxed px-6 pb-2">
        O CicloLivre não substitui avaliação médica. Previsões são estimativas baseadas no seu
        histórico.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Aba: Calendário                                                     */
/* ------------------------------------------------------------------ */

function CalendarTab({
  profile,
  analytics,
  currentMonth,
  setCurrentMonth,
  onDayClick,
  selectedDateKey,
  selectionMode,
  selectedDays,
  onToggleSelectionMode,
  onToggleDay,
  onOpenBatch,
}) {
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const firstDay = new Date(year, month, 1);
  const startOffset = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells = [];
  for (let i = 0; i < startOffset; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(new Date(year, month, d));

  const predicted = useMemo(() => {
    const set = new Set();
    if (!analytics.lastPeriodStart) return set;
    if (analytics.avgCycleLength == null || analytics.avgPeriodLength == null) return set;
    if (
      profile.lifeMode === 'pregnant' ||
      profile.lifeMode === 'postpartum' ||
      profile.lifeMode === 'perimenopause'
    ) {
      return set;
    }
    if (profile.contraceptive === 'continuous') return set;
    if ((profile.conditions || []).includes('hysterectomy')) return set;

    const nextStart = nextCycleStart(analytics.lastPeriodStart, analytics.avgCycleLength);
    if (!nextStart) return set;

    for (let i = 0; i < analytics.avgPeriodLength; i += 1) {
      set.add(formatDateKey(addDays(nextStart, i)));
    }
    return set;
  }, [
    analytics,
    profile.lifeMode,
    profile.contraceptive,
    profile.conditions,
  ]);

  const fertile = useMemo(() => {
    const empty = { days: new Set(), ovulation: null, enabled: false };
    if (!analytics.lastPeriodStart) return empty;
    if (analytics.avgCycleLength == null) return empty;
    if (
      profile.lifeMode === 'pregnant' ||
      profile.lifeMode === 'postpartum' ||
      profile.lifeMode === 'perimenopause'
    ) {
      return empty;
    }
    if (profile.contraceptive === 'continuous') return empty;
    if ((profile.conditions || []).includes('hysterectomy')) return empty;

    const nextStart = nextCycleStart(analytics.lastPeriodStart, analytics.avgCycleLength);
    if (!nextStart) return empty;

    const ovulation = addDays(nextStart, -14);
    const days = new Set();
    for (let offset = -5; offset <= 1; offset += 1) {
      days.add(formatDateKey(addDays(ovulation, offset)));
    }

    return { days, ovulation: formatDateKey(ovulation), enabled: true };
  }, [
    analytics,
    profile.lifeMode,
    profile.contraceptive,
    profile.conditions,
  ]);

  const todayKey = formatDateKey(new Date());
  const monthStats = useMemo(() => {
    let flow = 0;
    let registered = 0;
    Object.entries(profile.logs || {}).forEach(([k, v]) => {
      const d = parseDateKey(k);
      if (d.getMonth() !== month || d.getFullYear() !== year) return;
      registered += 1;
      if ((v.flow || []).some((f) => PERIOD_FLOWS.includes(f))) flow += 1;
    });
    return { flow, registered };
  }, [profile.logs, month, year]);

  return (
    <div className="space-y-4">
      <SectionCard>
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => setCurrentMonth(new Date(year, month - 1, 1))}
            className="p-2 rounded-lg active:bg-stone-100 text-stone-600"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h2 className="text-base font-bold text-stone-900">{monthTitle(currentMonth)}</h2>
          <button
            onClick={() => setCurrentMonth(new Date(year, month + 1, 1))}
            className="p-2 rounded-lg active:bg-stone-100 text-stone-600"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        <div className="flex items-center justify-between gap-2 mb-3">
          <p className="text-[11px] text-stone-500 leading-snug">
            {selectionMode
              ? 'Toque nos dias e aplique as mesmas opções de uma vez.'
              : 'Toque em um dia para registrar.'}
          </p>
          <button
            onClick={onToggleSelectionMode}
            className={`shrink-0 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border transition ${
              selectionMode
                ? 'bg-stone-900 text-white border-stone-900'
                : 'bg-white text-stone-600 border-stone-200 active:bg-stone-50'
            }`}
          >
            {selectionMode ? 'Cancelar seleção' : 'Selecionar dias'}
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1 mb-1">
          {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((d, i) => (
            <div key={`${d}-${i}`} className="text-center text-[10px] font-semibold text-stone-400 py-1">
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {cells.map((day, idx) => {
            if (!day) return <div key={`empty-${idx}`} />;
            const key = formatDateKey(day);
            const log = profile.logs[key] || {};
            const isToday = key === todayKey;
            const isSelected = !selectionMode && key === selectedDateKey;
            const isMultiSelected = selectionMode && selectedDays.includes(key);
            const hasFlow = (log.flow || []).some((f) => PERIOD_FLOWS.includes(f));
            const hasSpotting = (log.flow || []).includes('Escape (Spotting)');
            const hasSymptoms =
              DAILY_CATEGORIES.some((c) => c.key !== 'flow' && log[c.key]?.length) ||
              !!log.bbt ||
              !!log.painScale ||
              !!log.weight;
            const isPredicted = predicted.has(key);
            const isFertile = fertile.days.has(key);
            const isOvulation = fertile.ovulation === key;
            const isPregnant = !!log.pregnant;

            return (
              <button
                key={key}
                onClick={() => (selectionMode ? onToggleDay(key) : onDayClick(key))}
                className={`relative aspect-square rounded-xl flex flex-col items-center justify-center border transition ${
                  isMultiSelected
                    ? 'border-rose-500 bg-rose-100 ring-2 ring-rose-300'
                    : isSelected
                      ? 'border-rose-500 bg-rose-50'
                      : isToday
                        ? 'border-rose-300 bg-white'
                        : isOvulation
                          ? 'border-emerald-500 bg-emerald-50'
                          : isFertile
                            ? 'border-emerald-200 bg-emerald-50/70'
                            : isPregnant
                              ? 'border-pink-300 bg-pink-50'
                              : isPredicted
                                ? 'border-rose-100 bg-rose-50/60'
                                : 'border-transparent bg-white active:bg-stone-50'
                }`}
              >
                <span
                  className={`text-sm ${
                    isToday ? 'font-bold text-rose-700' : 'font-medium text-stone-700'
                  }`}
                >
                  {day.getDate()}
                </span>
                <span className="flex gap-0.5 mt-0.5 h-1.5 items-center">
                  {hasFlow && <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />}
                  {hasSpotting && !hasFlow && (
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-300" />
                  )}
                  {hasSymptoms && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
                  {isPregnant && <span className="w-1.5 h-1.5 rounded-full bg-pink-500" />}
                </span>
                {isMultiSelected && (
                  <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-rose-600 text-white flex items-center justify-center">
                    <Check className="w-3 h-3" />
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 mt-4 pt-3 border-t border-stone-100 text-[10px] text-stone-500">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-rose-500" /> Fluxo
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-amber-400" /> Sintomas
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-rose-100 border border-rose-200" /> Previsão
          </span>
          {fertile.enabled && (
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-400" /> Período fértil
            </span>
          )}
        </div>

        {fertile.enabled && (
          <p className="text-[10px] text-stone-400 text-center mt-2 leading-relaxed">
            Período fértil e ovulação estimados pela média do ciclo. Não use como método
            contraceptivo.
          </p>
        )}
      </SectionCard>

      {selectionMode && selectedDays.length > 0 && (
        <div className="sticky bottom-20 z-10 flex gap-2">
          <button
            onClick={() => setSelectedDays([])}
            className="flex-1 bg-white border border-stone-200 text-stone-700 text-xs font-semibold py-3 rounded-xl shadow"
          >
            Limpar ({selectedDays.length})
          </button>
          <button
            onClick={onOpenBatch}
            className="flex-[2] bg-rose-600 text-white text-xs font-semibold py-3 rounded-xl shadow active:bg-rose-700"
          >
            Registrar em {selectedDays.length} {selectedDays.length === 1 ? 'dia' : 'dias'}
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <SectionCard className="p-3!">
          <p className="text-[10px] uppercase font-semibold text-stone-400">Dias de fluxo</p>
          <p className="text-2xl font-bold text-rose-600">{monthStats.flow}</p>
        </SectionCard>
        <SectionCard className="p-3!">
          <p className="text-[10px] uppercase font-semibold text-stone-400">Dias registrados</p>
          <p className="text-2xl font-bold text-stone-800">{monthStats.registered}</p>
        </SectionCard>
      </div>

      <TrendsCard profile={profile} analytics={analytics} />

      <SectionCard>
        <h3 className="text-sm font-bold text-stone-900 mb-2">Histórico de ciclos</h3>
        {analytics.cycles.length === 0 ? (
          <p className="text-xs text-stone-500 leading-relaxed">
            Registre os dias de fluxo no calendário para ver a duração real dos seus ciclos.
          </p>
        ) : (
          <div className="space-y-1.5 max-h-56 overflow-y-auto no-scrollbar">
            {[...analytics.cycles].reverse().map((c) => (
              <div
                key={c.start}
                className="flex items-center justify-between text-xs bg-stone-50 rounded-lg px-3 py-2"
              >
                <span className="font-medium text-stone-700">
                  {formatBR(c.start, { day: '2-digit', month: 'short' })}
                </span>
                <span className="text-stone-500">{c.periodLength} dias de fluxo</span>
                <span className="text-stone-500">
                  {c.cycleLength ? `ciclo de ${c.cycleLength}d` : 'em andamento'}
                </span>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Aba: Guia                                                           */
/* ------------------------------------------------------------------ */

function GuideTab({ profile, guideFilter, setGuideFilter, onOpenArticle }) {
  const [search, setSearch] = useState('');
  const categories = ['all', ...Array.from(new Set(ARTICLES.map((a) => a.category)))];

  const list = ARTICLES.filter((a) => guideFilter === 'all' || a.category === guideFilter).filter(
    (a) =>
      !search ||
      a.title.toLowerCase().includes(search.toLowerCase()) ||
      a.tldr.toLowerCase().includes(search.toLowerCase())
  );

  const relevantForYou = (a) =>
    a.modes.includes(profile.lifeMode) ||
    a.conditions.some((c) => profile.conditions.includes(c)) ||
    a.methods.includes(profile.contraceptive);

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar conteúdo (ex.: SOP, lóquios, TPM)"
          className={`${inputClass} pl-9`}
        />
      </div>

      <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setGuideFilter(cat)}
            className={`shrink-0 text-xs px-3 py-1.5 rounded-full border font-medium transition ${
              guideFilter === cat
                ? 'bg-stone-900 text-white border-stone-900'
                : 'bg-white text-stone-600 border-stone-200'
            }`}
          >
            {cat === 'all' ? 'Todos' : cat}
          </button>
        ))}
      </div>

      {list.length === 0 && (
        <SectionCard>
          <p className="text-xs text-stone-500">Nenhum conteúdo encontrado para esta busca.</p>
        </SectionCard>
      )}

      <div className="space-y-3">
        {list.map((article) => (
          <button
            key={article.id}
            onClick={() => onOpenArticle(article)}
            className="w-full text-left bg-white rounded-2xl border border-stone-200/80 shadow-sm p-4 active:bg-stone-50"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-rose-50 text-rose-700">
                {article.category}
              </span>
              <span className="text-[10px] text-stone-400">{article.readTime} de leitura</span>
            </div>
            <h3 className="text-sm font-bold text-stone-900 mt-2 leading-snug">{article.title}</h3>
            <p className="text-xs text-stone-600 mt-1 leading-relaxed line-clamp-2">
              {article.tldr}
            </p>
            {relevantForYou(article) && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 mt-2 bg-emerald-50 px-2 py-0.5 rounded-md">
                <CheckCircle2 className="w-3 h-3" /> Relevante para seu perfil
              </span>
            )}
          </button>
        ))}
      </div>

      <p className="text-[10px] text-center text-stone-400 leading-relaxed px-4 pb-2">
        Conteúdo educativo baseado em diretrizes FEBRASGO, OMS e SBU. Não substitui consulta
        médica.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Aba: Relatório                                                      */
/* ------------------------------------------------------------------ */

function ReportTab({ reportText, copied, onCopy, onShare }) {
  return (
    <div className="space-y-4">
      <SectionCard>
        <div className="flex items-center gap-2 mb-1">
          <Stethoscope className="w-5 h-5 text-rose-600" />
          <h2 className="text-base font-bold text-stone-900">Relatório para consulta</h2>
        </div>
        <p className="text-xs text-stone-600 leading-relaxed">
          Resumo estruturado com suas médias de ciclo, métodos, condições e últimos registros.
          Copie e envie ao profissional de saúde ou mostre na consulta.
        </p>
        <div className="flex gap-2 mt-3">
          <button
            onClick={onCopy}
            className="flex-1 bg-stone-900 active:bg-stone-800 text-white text-sm font-semibold py-2.5 rounded-xl flex items-center justify-center gap-2"
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copied ? 'Copiado!' : 'Copiar texto'}
          </button>
          <button
            onClick={onShare}
            className="px-3.5 rounded-xl border border-stone-200 text-stone-700 active:bg-stone-50"
            title="Compartilhar"
          >
            <Share2 className="w-5 h-5" />
          </button>
        </div>
      </SectionCard>

      <SectionCard className="p-0! overflow-hidden">
        <pre className="text-[11px] leading-relaxed text-stone-700 whitespace-pre-wrap p-4 max-h-[60vh] overflow-y-auto font-mono">
          {reportText}
        </pre>
      </SectionCard>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Aba: Perfil                                                         */
/* ------------------------------------------------------------------ */

function ProfileTab({
  profiles,
  activeProfileId,
  setActiveProfileId,
  updateProfile,
  onAddProfile,
  onDeleteProfile,
  onAddDemo,
  onReset,
  onExport,
  onImport,
  lockEnabled,
  onOpenPin,
}) {
  const profile = profiles[activeProfileId];
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const toggleCondition = (id) => {
    const has = profile.conditions.includes(id);
    updateProfile({
      conditions: has
        ? profile.conditions.filter((c) => c !== id)
        : [...profile.conditions, id],
    });
  };

  return (
    <div className="space-y-4">
      <SectionCard>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold text-stone-900">Perfis</h2>
          <button
            onClick={onAddProfile}
            className="text-xs font-semibold text-rose-600 flex items-center gap-1 bg-rose-50 px-2.5 py-1.5 rounded-lg"
          >
            <Plus className="w-3.5 h-3.5" /> Novo perfil
          </button>
        </div>
        <div className="space-y-1.5">
          {Object.values(profiles).map((p) => (
            <button
              key={p.id}
              onClick={() => setActiveProfileId(p.id)}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border text-sm ${
                p.id === activeProfileId
                  ? 'border-rose-300 bg-rose-50 text-rose-900 font-semibold'
                  : 'border-stone-200 bg-white text-stone-700'
              }`}
            >
              <span className="flex items-center gap-2">
                <User className="w-4 h-4" />
                {p.name}
              </span>
              {p.id === activeProfileId && <Check className="w-4 h-4" />}
            </button>
          ))}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <div>
            <span className="text-xs font-medium text-stone-500">Nome</span>
            <input
              value={profile.name}
              onChange={(e) => updateProfile({ name: e.target.value })}
              className={`${inputClass} mt-1`}
            />
          </div>
          <div>
            <span className="text-xs font-medium text-stone-500">Altura (cm)</span>
            <input
              type="number"
              inputMode="decimal"
              value={profile.heightCm}
              onChange={(e) => updateProfile({ heightCm: e.target.value })}
              placeholder="165"
              className={`${inputClass} mt-1`}
            />
          </div>
        </div>
      </SectionCard>

      <SectionCard>
        <h3 className="text-sm font-bold text-stone-900 mb-1">Fase atual</h3>
        <p className="text-[11px] text-stone-500 mb-3">
          O app adapta previsões e alertas conforme a sua fase de vida.
        </p>
        <div className="space-y-2">
          {LIFE_MODES.map((mode) => {
            const Icon = mode.icon;
            const active = profile.lifeMode === mode.id;
            return (
              <button
                key={mode.id}
                onClick={() => updateProfile({ lifeMode: mode.id })}
                className={`w-full flex items-start gap-3 p-3 rounded-xl border text-left transition ${
                  active ? 'border-rose-400 bg-rose-50' : 'border-stone-200 bg-white'
                }`}
              >
                <span
                  className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${
                    active ? 'bg-rose-600 text-white' : 'bg-stone-100 text-stone-500'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                </span>
                <span className="flex-1">
                  <span className="block text-sm font-semibold text-stone-900">{mode.label}</span>
                  <span className="block text-[11px] text-stone-500 mt-0.5">{mode.desc}</span>
                </span>
                {active && <CheckCircle2 className="w-5 h-5 text-rose-600 shrink-0" />}
              </button>
            );
          })}
        </div>

        {profile.lifeMode === 'pregnant' && (
          <div className="mt-3">
            <Field label="Data da última menstruação (DUM)">
              <input
                type="date"
                value={profile.pregnancyLMP}
                onChange={(e) => updateProfile({ pregnancyLMP: e.target.value })}
                className={inputClass}
              />
            </Field>
          </div>
        )}

        {profile.lifeMode === 'postpartum' && (
          <div className="mt-3 space-y-2">
            <Field label="Data do parto">
              <input
                type="date"
                value={profile.postpartumDate}
                onChange={(e) => updateProfile({ postpartumDate: e.target.value })}
                className={inputClass}
              />
            </Field>
            <div>
              <span className="text-xs font-medium text-stone-500">Amamentação</span>
              <div className="flex gap-1.5 mt-1.5">
                {BREASTFEEDING.map((b) => (
                  <Chip
                    key={b.id}
                    active={profile.breastfeeding === b.id}
                    onClick={() => updateProfile({ breastfeeding: b.id })}
                  >
                    {b.label}
                  </Chip>
                ))}
              </div>
            </div>
          </div>
        )}
      </SectionCard>

      <SectionCard>
        <h3 className="text-sm font-bold text-stone-900 mb-1">Contracepção</h3>
        <p className="text-[11px] text-stone-500 mb-2">
          Métodos definitivos ou contínuos desativam alertas de risco de gravidez.
        </p>
        <select
          value={profile.contraceptive}
          onChange={(e) => updateProfile({ contraceptive: e.target.value })}
          className={inputClass}
        >
          {CONTRACEPTIVES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>

        {profile.contraceptive === 'vasectomy' && (
          <label className="mt-2 flex items-start gap-2 text-xs text-stone-700 bg-amber-50 border border-amber-200 rounded-xl p-3">
            <input
              type="checkbox"
              checked={profile.vasectomyConfirmed}
              onChange={(e) => updateProfile({ vasectomyConfirmed: e.target.checked })}
              className="mt-0.5 w-4 h-4 accent-rose-600"
            />
            <span>
              <strong>Espermograma de controle confirmado</strong> (azoospermia). Enquanto não
              confirmado, o app mantém o alerta de teste de gravidez em caso de atraso.
            </span>
          </label>
        )}
      </SectionCard>

      <SectionCard>
        <h3 className="text-sm font-bold text-stone-900 mb-1">Condições de saúde</h3>
        <p className="text-[11px] text-stone-500 mb-2">
          Ajusta alertas, oculta campos e personaliza a biblioteca de conteúdos.
        </p>
        <div className="space-y-2">
          {HEALTH_CONDITIONS.map((c) => {
            const active = profile.conditions.includes(c.id);
            return (
              <button
                key={c.id}
                onClick={() => toggleCondition(c.id)}
                className={`w-full text-left p-3 rounded-xl border flex items-start gap-2 ${
                  active ? 'border-purple-300 bg-purple-50' : 'border-stone-200 bg-white'
                }`}
              >
                <span
                  className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                    active ? 'bg-purple-600 border-purple-600' : 'border-stone-300'
                  }`}
                >
                  {active && <Check className="w-3 h-3 text-white" />}
                </span>
                <span>
                  <span className="block text-xs font-semibold text-stone-800">{c.label}</span>
                  <span className="block text-[10px] text-stone-500 mt-0.5">{c.desc}</span>
                </span>
              </button>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard>
        <h3 className="text-sm font-bold text-stone-900 mb-2">Padrões do ciclo</h3>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Ciclo médio (dias)">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={3}
              placeholder="Não informado"
              value={profile.defaultCycleLength ?? ''}
              onChange={(e) =>
                /^\d*$/.test(e.target.value) &&
                updateProfile({
                  defaultCycleLength: e.target.value === '' ? null : e.target.value,
                })
              }
              onFocus={(e) => e.target.select()}
              onBlur={(e) =>
                updateProfile({
                  defaultCycleLength: clampOptionalInteger(e.target.value, 15, 120),
                })
              }
              className={inputClass}
            />
            <button
              type="button"
              onClick={() => updateProfile({ defaultCycleLength: null })}
              className="mt-1 text-[10px] font-medium text-rose-700 underline underline-offset-2"
            >
              Não sei / deixar em branco
            </button>
          </Field>
          <Field label="Menstruação (dias)">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={2}
              placeholder="Não informado"
              value={profile.defaultPeriodLength ?? ''}
              onChange={(e) =>
                /^\d*$/.test(e.target.value) &&
                updateProfile({
                  defaultPeriodLength: e.target.value === '' ? null : e.target.value,
                })
              }
              onFocus={(e) => e.target.select()}
              onBlur={(e) =>
                updateProfile({
                  defaultPeriodLength: clampOptionalInteger(e.target.value, 1, 20),
                })
              }
              className={inputClass}
            />
            <button
              type="button"
              onClick={() => updateProfile({ defaultPeriodLength: null })}
              className="mt-1 text-[10px] font-medium text-rose-700 underline underline-offset-2"
            >
              Não sei / deixar em branco
            </button>
          </Field>
        </div>
        <p className="text-[10px] text-stone-400 mt-2 leading-relaxed">
          Usados apenas quando ainda não há histórico suficiente de registros.
        </p>
      </SectionCard>

      <SectionCard>
        <div className="flex items-center gap-2 mb-1">
          <Lock className="w-4 h-4 text-stone-700" />
          <h3 className="text-sm font-bold text-stone-900">Segurança</h3>
        </div>
        <p className="text-[11px] text-stone-500 mb-3 leading-relaxed">
          Bloqueie o app com um PIN de {PIN_LENGTH} dígitos. O PIN fica apenas neste dispositivo e
          não é enviado para nenhum servidor.
        </p>
        <button
          onClick={onOpenPin}
          className="w-full text-xs font-semibold py-2.5 rounded-xl border border-stone-200 text-stone-700 flex items-center justify-center gap-2 active:bg-stone-50"
        >
          <KeyRound className="w-4 h-4" />
          {lockEnabled ? 'Alterar ou desativar PIN' : 'Ativar bloqueio por PIN'}
        </button>
      </SectionCard>

      <SectionCard>
        <h3 className="text-sm font-bold text-stone-900 mb-2">Dados</h3>
        <div className="space-y-2">
          <button
            onClick={onExport}
            className="w-full text-xs font-semibold py-2.5 rounded-xl bg-stone-900 text-white flex items-center justify-center gap-2 active:bg-stone-800"
          >
            <Download className="w-4 h-4" /> Exportar backup (.json)
          </button>
          <button
            onClick={onImport}
            className="w-full text-xs font-medium py-2.5 rounded-xl border border-stone-200 text-stone-700 flex items-center justify-center gap-2 active:bg-stone-50"
          >
            <Upload className="w-4 h-4" /> Importar backup
          </button>
          <p className="text-[10px] text-stone-400 leading-relaxed px-1">
            Desinstalar o app apaga todos os registros. Faça backups regulares.
          </p>
          <button
            onClick={onAddDemo}
            className="w-full text-xs font-medium py-2.5 rounded-xl border border-stone-200 text-stone-700 flex items-center justify-center gap-2 active:bg-stone-50"
          >
            <Sparkles className="w-4 h-4" /> Carregar dados de exemplo
          </button>
          {confirmReset ? (
            <div className="flex gap-2">
              <button
                onClick={() => {
                  onReset();
                  setConfirmReset(false);
                }}
                className="flex-1 text-xs font-semibold py-2.5 rounded-xl bg-rose-600 text-white"
              >
                Confirmar limpeza
              </button>
              <button
                onClick={() => setConfirmReset(false)}
                className="px-3 text-xs font-medium rounded-xl border border-stone-200"
              >
                Cancelar
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmReset(true)}
              className="w-full text-xs font-medium py-2.5 rounded-xl border border-stone-200 text-stone-700 flex items-center justify-center gap-2 active:bg-stone-50"
            >
              <RotateCcw className="w-4 h-4" /> Apagar todos os registros
            </button>
          )}

          {Object.keys(profiles).length > 1 &&
            (confirmDelete ? (
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    onDeleteProfile(profile.id);
                    setConfirmDelete(false);
                  }}
                  className="flex-1 text-xs font-semibold py-2.5 rounded-xl bg-rose-600 text-white"
                >
                  Excluir perfil
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="px-3 text-xs font-medium rounded-xl border border-stone-200"
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="w-full text-xs font-medium py-2.5 rounded-xl border border-rose-200 text-rose-600 flex items-center justify-center gap-2 active:bg-rose-50"
              >
                <Trash2 className="w-4 h-4" /> Excluir este perfil
              </button>
            ))}
        </div>
      </SectionCard>

      <p className="text-[10px] text-center text-stone-400 pb-2">
        CicloLivre v1.0 • Dados salvos apenas neste dispositivo
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Modal: registro diário                                               */
/* ------------------------------------------------------------------ */

function LogSheet({ profile, dateKey, onChangeDate, onClose, toggleOption, updateDayField, clearDay }) {
  const log = profile.logs[dateKey] || {};
  const hasHysterectomy = profile.conditions.includes('hysterectomy');
  const categories = DAILY_CATEGORIES.filter((c) => !(hasHysterectomy && c.key === 'flow'));

  return (
    <div className="fixed inset-0 z-50 bg-stone-900/40 flex items-end justify-center">
      <div className="w-full max-w-lg bg-stone-50 rounded-t-3xl max-h-[92vh] flex flex-col sheet-anim">
        <div className="sticky top-0 bg-stone-50 rounded-t-3xl border-b border-stone-200 px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-[10px] uppercase font-semibold text-stone-400">Registro diário</p>
            <h2 className="text-base font-bold text-stone-900">
              {formatBR(dateKey, {
                weekday: 'long',
                day: '2-digit',
                month: 'long',
              })}
            </h2>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onChangeDate(formatDateKey(addDays(parseDateKey(dateKey), -1)))}
              className="p-2 rounded-lg active:bg-stone-200 text-stone-600"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={() => onChangeDate(formatDateKey(addDays(parseDateKey(dateKey), 1)))}
              className="p-2 rounded-lg active:bg-stone-200 text-stone-600"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
            <button onClick={onClose} className="p-2 rounded-lg bg-stone-200 text-stone-700 ml-1">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto px-4 py-4 space-y-5 pb-8">
          {categories.map((cat) => {
            const Icon = cat.icon;
            const selected = log[cat.key] || [];
            return (
              <div key={cat.key}>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${cat.color}`}>
                    <Icon className="w-4 h-4" />
                  </span>
                  <h3 className="text-xs font-bold text-stone-800 uppercase tracking-wide">
                    {cat.title}
                  </h3>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {cat.options.map((opt) => (
                    <Chip
                      key={opt}
                      active={selected.includes(opt)}
                      onClick={() => toggleOption(cat.key, opt)}
                    >
                      {opt}
                    </Chip>
                  ))}
                </div>
              </div>
            );
          })}

          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold text-stone-800 uppercase tracking-wide">
                Dor pélvica
              </h3>
              <span className="text-xs font-bold text-rose-600">{log.painScale ?? 0}/10</span>
            </div>
            <input
              type="range"
              min="0"
              max="10"
              value={log.painScale ?? 0}
              onChange={(e) => updateDayField('painScale', parseInt(e.target.value, 10))}
              className="w-full"
            />
            <div className="flex justify-between text-[10px] text-stone-400 mt-1">
              <span>Sem dor</span>
              <span>Insuportável</span>
            </div>
          </div>

          <div>
            <h3 className="text-xs font-bold text-stone-800 uppercase tracking-wide mb-2">
              Testes de LH / Gravidez
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {LH_OPTIONS.map((opt) => (
                <Chip
                  key={opt}
                  active={(log.tests || []).includes(opt)}
                  onClick={() => toggleOption('tests', opt)}
                >
                  {opt}
                </Chip>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Temperatura basal (°C)">
              <input
                type="number"
                step="0.1"
                inputMode="decimal"
                value={log.bbt || ''}
                placeholder="36.5"
                onChange={(e) => updateDayField('bbt', e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Peso (kg)">
              <input
                type="number"
                step="0.1"
                inputMode="decimal"
                value={log.weight || ''}
                placeholder="64.5"
                onChange={(e) => updateDayField('weight', e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>

          <Field label="Anotações do dia">
            <textarea
              value={log.notes || ''}
              onChange={(e) => updateDayField('notes', e.target.value)}
              rows={3}
              placeholder="Como você se sentiu hoje, gatilhos, medicações…"
              className={`${inputClass} resize-none`}
            />
          </Field>

          <button
            type="button"
            onClick={() => updateDayField('pregnant', !log.pregnant)}
            className={`w-full text-xs font-semibold py-2.5 rounded-xl border flex items-center justify-center gap-2 transition ${
              log.pregnant
                ? 'bg-pink-600 text-white border-pink-600'
                : 'bg-white text-stone-700 border-stone-200 active:bg-stone-50'
            }`}
          >
            <Baby className="w-4 h-4" />
            {log.pregnant ? 'Dia marcado como gravidez' : 'Marcar dia como gravidez'}
          </button>

          <button
            onClick={clearDay}
            className="w-full text-xs font-medium py-2.5 rounded-xl border border-stone-200 text-stone-600 flex items-center justify-center gap-2 active:bg-stone-100"
          >
            <Trash2 className="w-4 h-4" /> Limpar registros deste dia
          </button>

          <p className="text-[10px] text-stone-400 text-center leading-relaxed">
            Suas escolhas são salvas automaticamente neste dispositivo.
          </p>
        </div>

        <div className="border-t border-stone-200 px-4 py-3 bg-white pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button
            onClick={onClose}
            className="w-full bg-rose-600 active:bg-rose-700 text-white font-semibold text-sm py-3 rounded-xl"
          >
            Concluir
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Modal: registro em vários dias                                      */
/* ------------------------------------------------------------------ */

function BatchLogSheet({ profile, days, onClose, onApply }) {
  const [patch, setPatch] = useState({});
  const hasHysterectomy = (profile.conditions || []).includes('hysterectomy');
  const categories = DAILY_CATEGORIES.filter((c) => !(hasHysterectomy && c.key === 'flow'));
  const ordered = [...days].sort();
  const selectedCount = Object.values(patch).reduce((acc, list) => acc + list.length, 0);

  const toggle = (categoryKey, option) => {
    setPatch((prev) => {
      const current = prev[categoryKey] || [];
      const next = current.includes(option)
        ? current.filter((item) => item !== option)
        : [...current, option];
      const copy = { ...prev };
      if (next.length > 0) copy[categoryKey] = next;
      else delete copy[categoryKey];
      return copy;
    });
  };

  const rangeLabel =
    ordered.length === 1
      ? formatBR(ordered[0], { weekday: 'short', day: '2-digit', month: 'short' })
      : `${formatBR(ordered[0], { day: '2-digit', month: '2-digit' })} a ${formatBR(
          ordered[ordered.length - 1],
          { day: '2-digit', month: '2-digit' }
        )}`;

  return (
    <div className="fixed inset-0 z-50 bg-stone-900/40 flex items-end justify-center">
      <div className="w-full max-w-lg bg-stone-50 rounded-t-3xl max-h-[92vh] flex flex-col sheet-anim">
        <div className="sticky top-0 bg-stone-50 rounded-t-3xl border-b border-stone-200 px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-[10px] uppercase font-semibold text-stone-400">Registro em vários dias</p>
            <h2 className="text-base font-bold text-stone-900">
              {ordered.length} {ordered.length === 1 ? 'dia selecionado' : 'dias selecionados'}
            </h2>
            <p className="text-[11px] text-stone-500 mt-0.5">{rangeLabel}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg bg-stone-200 text-stone-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto px-4 py-4 space-y-5 pb-8">
          <div className="flex gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-900">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              Marque o que aconteceu nesses dias. O que já estiver registrado é mantido e somado — nada
              é apagado.
            </p>
          </div>

          {categories.map((cat) => {
            const Icon = cat.icon;
            const selected = patch[cat.key] || [];
            return (
              <div key={cat.key}>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${cat.color}`}>
                    <Icon className="w-4 h-4" />
                  </span>
                  <h3 className="text-xs font-bold text-stone-800 uppercase tracking-wide">
                    {cat.title}
                  </h3>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {cat.options.map((opt) => (
                    <Chip
                      key={opt}
                      active={selected.includes(opt)}
                      onClick={() => toggle(cat.key, opt)}
                    >
                      {opt}
                    </Chip>
                  ))}
                </div>
              </div>
            );
          })}

          <p className="text-[10px] text-stone-400 text-center leading-relaxed">
            Dor, temperatura, peso e anotações continuam sendo registrados dia a dia.
          </p>
        </div>

        <div className="border-t border-stone-200 px-4 py-3 bg-white pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button
            onClick={() => onApply(patch)}
            disabled={selectedCount === 0}
            className="w-full bg-rose-600 active:bg-rose-700 disabled:bg-stone-200 disabled:text-stone-400 text-white font-semibold text-sm py-3 rounded-xl"
          >
            {selectedCount === 0
              ? 'Escolha ao menos uma opção'
              : `Aplicar a ${ordered.length} ${ordered.length === 1 ? 'dia' : 'dias'}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Modal: artigo                                                       */
/* ------------------------------------------------------------------ */

function ArticleSheet({ article, onClose }) {
  if (!article) return null;
  return (
    <div className="fixed inset-0 z-50 bg-stone-900/40 flex items-end justify-center">
      <div className="w-full max-w-lg bg-white rounded-t-3xl max-h-[92vh] flex flex-col sheet-anim">
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-100">
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-rose-50 text-rose-700">
            {article.category}
          </span>
          <button onClick={onClose} className="p-2 rounded-lg bg-stone-100 text-stone-700">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4 space-y-4 pb-8">
          <h2 className="text-lg font-bold text-stone-900 leading-snug">{article.title}</h2>
          <p className="text-[10px] text-stone-400">{article.readTime} de leitura</p>

          <div className="bg-rose-50 border border-rose-100 rounded-xl p-3">
            <p className="text-[10px] uppercase font-bold text-rose-700 mb-1">Resumo rápido</p>
            <p className="text-xs text-stone-700 leading-relaxed">{article.tldr}</p>
          </div>

          <p className="text-sm text-stone-700 leading-relaxed">{article.body}</p>

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-[10px] uppercase font-bold text-amber-700 mb-1">
                Quando procurar ajuda
              </p>
              <p className="text-xs text-stone-700 leading-relaxed">{article.doctorAlert}</p>
            </div>
          </div>

          <p className="text-[10px] text-stone-400 italic">Fonte: {article.source}</p>
        </div>
        <div className="border-t border-stone-100 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button
            onClick={onClose}
            className="w-full bg-stone-900 text-white font-semibold text-sm py-3 rounded-xl"
          >
            Entendi
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */

const TABS = [
  { id: 'today', label: 'Hoje', icon: Sun },
  { id: 'calendar', label: 'Calendário', icon: CalendarIcon },
  { id: 'guide', label: 'Guia', icon: BookOpen },
  { id: 'report', label: 'Relatório', icon: FileText },
  { id: 'profile', label: 'Perfil', icon: User },
];

export default function App() {
  const [initial] = useState(loadProfiles);
  const [profiles, setProfiles] = useState(initial.profiles);
  const [activeProfileId, setActiveProfileId] = useState(() => {
    try {
      const saved = localStorage.getItem(ACTIVE_KEY);
      if (saved) return saved;
    } catch {
      /* ignore */
    }
    return 'p1';
  });
  const [activeTab, setActiveTab] = useState('today');
  const [selectedDateKey, setSelectedDateKey] = useState(formatDateKey(new Date()));
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [logOpen, setLogOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedDays, setSelectedDays] = useState([]);
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [guideFilter, setGuideFilter] = useState('all');
  const [copied, setCopied] = useState(false);
  const [showInstallTip, setShowInstallTip] = useState(false);

  const [storageError, setStorageError] = useState(initial.error);
  const [saveError, setSaveError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const [lockConfig, setLockConfig] = useState(readLockConfig);
  const [locked, setLocked] = useState(() => readLockConfig().enabled);
  const [pinSheet, setPinSheet] = useState(null);
  const [forgotOpen, setForgotOpen] = useState(false);
  const lastActiveRef = useRef(Date.now());

  const [timerRunning, setTimerRunning] = useState(false);
  const [startTime, setStartTime] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [intensity, setIntensity] = useState('Moderada');

  const activeId = profiles[activeProfileId] ? activeProfileId : Object.keys(profiles)[0];
  const profile = profiles[activeId];

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
      setSaveError(null);
    } catch {
      setSaveError(
        'Não foi possível salvar seus dados. Libere espaço no dispositivo e exporte um backup.'
      );
    }
  }, [profiles]);

  useEffect(() => {
    try {
      if (activeId) localStorage.setItem(ACTIVE_KEY, activeId);
    } catch {
      /* armazenamento indisponível */
    }
  }, [activeId]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        lastActiveRef.current = Date.now();
      } else if (lockConfig.enabled && Date.now() - lastActiveRef.current > LOCK_TIMEOUT_MS) {
        setLocked(true);
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [lockConfig.enabled]);

  useEffect(() => {
    let handle;
    try {
      CapacitorApp.addListener('appStateChange', ({ isActive }) => {
        if (!isActive) {
          lastActiveRef.current = Date.now();
        } else if (lockConfig.enabled && Date.now() - lastActiveRef.current > LOCK_TIMEOUT_MS) {
          setLocked(true);
        }
      }).then((listener) => {
        handle = listener;
      });
    } catch {
      /* ambiente web sem plugin nativo */
    }
    return () => {
      if (handle) handle.remove();
    };
  }, [lockConfig.enabled]);

  useEffect(() => {
    let id;
    if (timerRunning && startTime) {
      id = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTime) / 1000));
      }, 250);
    }
    return () => clearInterval(id);
  }, [timerRunning, startTime]);

  // Botão "voltar" do Android: fecha modais antes de sair do app
  useEffect(() => {
    let handle;
    try {
      CapacitorApp.addListener('backButton', () => {
        if (locked) return;
        if (pinSheet) return setPinSheet(null);
        if (exportOpen) return setExportOpen(false);
        if (importOpen) return setImportOpen(false);
        if (logOpen) return setLogOpen(false);
        if (selectedArticle) return setSelectedArticle(null);
        if (showInstallTip) return setShowInstallTip(false);
        if (!profile.onboarded) return updateProfile({ onboarded: true });
        if (activeTab !== 'today') return setActiveTab('today');
        CapacitorApp.exitApp();
      }).then((h) => {
        handle = h;
      });
    } catch {
      /* ambiente web sem plugin nativo */
    }
    return () => {
      if (handle) handle.remove();
    };
  }, [
    locked,
    pinSheet,
    exportOpen,
    importOpen,
    logOpen,
    selectedArticle,
    showInstallTip,
    activeTab,
    profile.onboarded,
  ]);

  const updateProfile = (patch) => {
    setProfiles((prev) => {
      const id = prev[activeId] ? activeId : Object.keys(prev)[0];
      if (!id) return prev;
      return { ...prev, [id]: { ...prev[id], ...patch } };
    });
  };

  const analytics = useMemo(() => computeCycleAnalytics(profile), [profile]);
  const status = useMemo(() => computeTodayStatus(profile, analytics), [profile, analytics]);
  const forecast = useMemo(() => computeCycleForecast(profile, analytics), [profile, analytics]);

  const recommendedArticle = useMemo(() => {
    const match = ARTICLES.find(
      (art) =>
        art.conditions.some((c) => profile.conditions.includes(c)) ||
        art.methods.includes(profile.contraceptive) ||
        art.modes.includes(profile.lifeMode)
    );
    return match || ARTICLES[0];
  }, [profile]);

  const weightHistory = useMemo(
    () =>
      Object.entries(profile.logs || {})
        .filter(([, data]) => data.weight && parseFloat(data.weight) > 0)
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([date, data]) => ({
          date,
          weight: data.weight,
          bmi: calculateBMI(data.weight, profile.heightCm),
        })),
    [profile.logs, profile.heightCm]
  );

  const reportText = useMemo(
    () => buildReportText(profile, analytics, weightHistory),
    [profile, analytics, weightHistory]
  );

  const todayKey = formatDateKey(new Date());
  const todayLog = profile.logs[todayKey] || {};

  const toggleOption = (categoryKey, option) => {
    setProfiles((prev) => {
      const id = prev[activeId] ? activeId : Object.keys(prev)[0];
      if (!id) return prev;
      const current = prev[id];
      const entry = current.logs[selectedDateKey] || {};
      const existing = entry[categoryKey] || [];
      const updated = existing.includes(option)
        ? existing.filter((item) => item !== option)
        : [...existing, option];

      return {
        ...prev,
        [id]: {
          ...current,
          logs: {
            ...current.logs,
            [selectedDateKey]: { ...entry, [categoryKey]: updated },
          },
        },
      };
    });
  };

  const updateDayField = (field, value) => {
    setProfiles((prev) => {
      const id = prev[activeId] ? activeId : Object.keys(prev)[0];
      if (!id) return prev;
      const current = prev[id];
      const entry = current.logs[selectedDateKey] || {};

      return {
        ...prev,
        [id]: {
          ...current,
          logs: {
            ...current.logs,
            [selectedDateKey]: { ...entry, [field]: value },
          },
        },
      };
    });
  };

  const clearDay = () => {
    setProfiles((prev) => {
      const id = prev[activeId] ? activeId : Object.keys(prev)[0];
      if (!id) return prev;
      const current = prev[id];
      const nextLogs = { ...current.logs };
      delete nextLogs[selectedDateKey];
      return { ...prev, [id]: { ...current, logs: nextLogs } };
    });
  };

  const handleTimerToggle = () => {
    if (!timerRunning) {
      setStartTime(Date.now());
      setElapsed(0);
      setTimerRunning(true);
      return;
    }
    const endTime = Date.now();
    const durationSec = Math.max(1, Math.round((endTime - startTime) / 1000));
    const prevList = profile.contractions || [];
    const intervalSec = prevList.length > 0 ? Math.round((startTime - prevList[0].startTimestamp) / 1000) : null;
    const newEntry = {
      id: String(endTime),
      date: formatDateKey(new Date()),
      timeStr: new Date(startTime).toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
      }),
      startTimestamp: startTime,
      durationSec,
      intervalSec,
      intensity,
    };
    updateProfile({ contractions: [newEntry, ...prevList] });
    setTimerRunning(false);
    setStartTime(null);
    setElapsed(0);
  };

  const handleCopy = async () => {
    const ok = await copyText(reportText);
    setCopied(ok);
    if (ok) {
      setTimeout(() => setCopied(false), 2200);
    } else {
      setNotice('Não foi possível copiar o relatório.');
    }
  };

  const handleShare = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Relatório CicloLivre', text: reportText });
      } else {
        await handleCopy();
      }
    } catch {
      /* usuário cancelou */
    }
  };

  const addProfile = () => {
    const id = `p${Date.now()}`;
    setProfiles((prev) => ({ ...prev, [id]: createProfile(id, `Perfil ${Object.keys(prev).length + 1}`) }));
    setActiveProfileId(id);
  };

  const deleteProfile = (id) => {
    const remaining = Object.keys(profiles).filter((key) => key !== id);
    if (!remaining.length) return;

    setProfiles((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setActiveProfileId(remaining[0]);
  };

  const addDemo = () => {
    const demo = buildDemoData();
    updateProfile({
      logs: { ...(profile.logs || {}), ...demo.logs },
      heightCm: profile.heightCm || demo.heightCm,
    });
  };

  const handleBatchApply = (patch) => {
    setProfiles((prev) => {
      const id = prev[activeId] ? activeId : Object.keys(prev)[0];
      if (!id) return prev;
      const current = prev[id];
      const nextLogs = { ...current.logs };
      selectedDays.forEach((day) => {
        const existing = nextLogs[day] || {};
        const merged = { ...existing };
        Object.entries(patch).forEach(([key, options]) => {
          const currentList = Array.isArray(existing[key]) ? existing[key] : [];
          merged[key] = [...new Set([...currentList, ...options])];
        });
        nextLogs[day] = merged;
      });
      return { ...prev, [id]: { ...current, logs: nextLogs } };
    });
    setBatchOpen(false);
    setSelectionMode(false);
    setSelectedDays([]);
    setNotice(`Registro aplicado a ${selectedDays.length} ${selectedDays.length === 1 ? 'dia' : 'dias'}.`);
  };
  const resetData = () => {
    updateProfile({ logs: {}, contractions: [], lastPeriodStart: null });
  };

  const handleReplaceImport = (result) => {
    setProfiles(result.profiles);
    setActiveProfileId(result.activeProfileId);
    setImportOpen(false);
    setNotice(
      `Backup restaurado: ${result.summary.profiles} perfil(is) e ${result.summary.logDays} dia(s) de registro.`
    );
  };

  const handleMergeImport = (result) => {
    setProfiles((prev) => mergeProfiles(prev, result.profiles));
    setImportOpen(false);
    setNotice('Backup mesclado com os dados atuais.');
  };

  const handlePinDone = (message) => {
    setPinSheet(null);
    setLockConfig(readLockConfig());
    setLocked(false);
    lastActiveRef.current = Date.now();
    setNotice(message);
  };

  const handleUnlock = () => {
    lastActiveRef.current = Date.now();
    setLocked(false);
  };

  if (locked) {
    return (
      <>
        <LockScreen onUnlock={handleUnlock} onForgot={() => setForgotOpen(true)} />
        {forgotOpen && (
          <div className="fixed inset-0 z-[90] bg-stone-900/50 flex items-center justify-center p-6 fade-in">
            <div className="w-full max-w-sm bg-white rounded-2xl p-5 shadow-xl">
              <h3 className="text-sm font-bold text-stone-900">Esqueceu o PIN?</h3>
              <p className="text-xs text-stone-600 leading-relaxed mt-2">
                Por segurança, o PIN não pode ser recuperado. Para voltar a usar o app, limpe os
                dados do CicloLivre nas configurações do Android e importe um backup.
              </p>
              <p className="text-xs text-stone-600 leading-relaxed mt-2">
                Se você não tiver um backup, os registros serão perdidos.
              </p>
              <button
                onClick={() => setForgotOpen(false)}
                className="mt-4 w-full bg-stone-900 text-white text-sm font-semibold py-2.5 rounded-xl"
              >
                Entendi
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="min-h-full bg-stone-50 text-stone-900">
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-stone-200 pt-[env(safe-area-inset-top)]">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 shrink-0 rounded-xl bg-rose-600 flex items-center justify-center">
              <Heart className="w-4 h-4 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-bold leading-none text-stone-900">CicloLivre</h1>
              <p className="text-[10px] text-stone-500 mt-0.5 truncate max-w-[150px]">
                Acompanhamento real & sem julgamentos
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <select
              value={activeId}
              onChange={(e) => setActiveProfileId(e.target.value)}
              className="text-[11px] font-medium bg-stone-100 border border-stone-200 rounded-lg px-2 py-1.5 text-stone-700 max-w-[120px] focus:outline-none"
            >
              {Object.values(profiles).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              onClick={() => setShowInstallTip(true)}
              className="p-1.5 rounded-lg bg-rose-50 text-rose-600"
              title="Sobre o app"
            >
              <Smartphone className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {(saveError || storageError) && (
        <div className="max-w-lg mx-auto px-4 pt-3">
          <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-[11px] text-rose-900">
            <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold">Seus dados podem não estar salvos</p>
              <p className="mt-0.5 leading-relaxed">{saveError || storageError}</p>
            </div>
            <button
              onClick={() => setExportOpen(true)}
              className="shrink-0 font-semibold underline"
            >
              Exportar
            </button>
            <button
              onClick={() => {
                setSaveError(null);
                setStorageError(null);
              }}
              aria-label="Fechar aviso"
              className="shrink-0 text-rose-500"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <main className="max-w-lg mx-auto px-4 pt-4 pb-24">
        {activeTab === 'today' && (
          <TodayTab
            profile={profile}
            analytics={analytics}
            status={status}
            forecast={forecast}
            todayLog={todayLog}
            recommendedArticle={recommendedArticle}
            latestWeight={weightHistory[0] || null}
            onOpenLogToday={() => {
              setSelectedDateKey(todayKey);
              setLogOpen(true);
            }}
            onOpenArticle={setSelectedArticle}
            onGoCalendar={() => setActiveTab('calendar')}
            contractions={profile.contractions || []}
            timer={{ running: timerRunning, elapsed }}
            onTimerToggle={handleTimerToggle}
            intensity={intensity}
            setIntensity={setIntensity}
            onClearContractions={() => updateProfile({ contractions: [] })}
          />
        )}

        {activeTab === 'calendar' && (
          <CalendarTab
            profile={profile}
            analytics={analytics}
            currentMonth={currentMonth}
            setCurrentMonth={setCurrentMonth}
            selectedDateKey={selectedDateKey}
            onDayClick={(key) => {
              setSelectedDateKey(key);
              setLogOpen(true);
            }}
            selectionMode={selectionMode}
            selectedDays={selectedDays}
            onToggleSelectionMode={() => {
              setSelectionMode((v) => !v);
              if (selectionMode) setSelectedDays([]);
            }}
            onToggleDay={(key) =>
              setSelectedDays((prev) =>
                prev.includes(key) ? prev.filter((d) => d !== key) : [...prev, key]
              )
            }
            onOpenBatch={() => setBatchOpen(true)}
          />
        )}

        {activeTab === 'guide' && (
          <GuideTab
            profile={profile}
            guideFilter={guideFilter}
            setGuideFilter={setGuideFilter}
            onOpenArticle={setSelectedArticle}
          />
        )}

        {activeTab === 'report' && (
          <ReportTab
            reportText={reportText}
            copied={copied}
            onCopy={handleCopy}
            onShare={handleShare}
          />
        )}

        {activeTab === 'profile' && (
          <ProfileTab
            profiles={profiles}
            activeProfileId={activeId}
            setActiveProfileId={setActiveProfileId}
            updateProfile={updateProfile}
            onAddProfile={addProfile}
            onDeleteProfile={deleteProfile}
            onAddDemo={addDemo}
            onReset={resetData}
            onExport={() => setExportOpen(true)}
            onImport={() => setImportOpen(true)}
            lockEnabled={lockConfig.enabled}
            onOpenPin={() => setPinSheet(lockConfig.enabled ? 'change' : 'setup')}
          />
        )}
      </main>

      <nav className="fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur border-t border-stone-200">
        <div className="max-w-lg mx-auto grid grid-cols-5 px-1 pb-[env(safe-area-inset-bottom)]">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex flex-col items-center gap-1 py-2.5 ${
                  active ? 'text-rose-600' : 'text-stone-400'
                }`}
              >
                <Icon className={`w-5 h-5 ${active ? '' : 'opacity-80'}`} />
                <span className="text-[10px] font-medium">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {logOpen && (
        <LogSheet
          profile={profile}
          dateKey={selectedDateKey}
          onChangeDate={setSelectedDateKey}
          onClose={() => setLogOpen(false)}
          toggleOption={toggleOption}
          updateDayField={updateDayField}
          clearDay={clearDay}
        />
      )}

      {batchOpen && selectedDays.length > 0 && (
        <BatchLogSheet
          profile={profile}
          days={selectedDays}
          onClose={() => setBatchOpen(false)}
          onApply={handleBatchApply}
        />
      )}

      {selectedArticle && (
        <ArticleSheet article={selectedArticle} onClose={() => setSelectedArticle(null)} />
      )}

      {showInstallTip && (
        <div className="fixed inset-0 z-50 bg-stone-900/40 flex items-center justify-center p-6 fade-in">
          <div className="w-full max-w-sm bg-white rounded-2xl p-5 shadow-xl">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-600" />
                <h3 className="text-sm font-bold text-stone-900">Privacidade em primeiro lugar</h3>
              </div>
              <button onClick={() => setShowInstallTip(false)} className="text-stone-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-stone-600 leading-relaxed mt-2">
              Todos os seus registros ficam salvos apenas neste dispositivo, sem servidores, sem
              contas e sem compartilhamento.
            </p>
            <ul className="text-xs text-stone-600 mt-3 space-y-1.5">
              <li className="flex gap-1.5">
                <Info className="w-3.5 h-3.5 text-rose-500 shrink-0 mt-0.5" />
                O app não faz previsões rígidas de 28 dias.
              </li>
              <li className="flex gap-1.5">
                <Info className="w-3.5 h-3.5 text-rose-500 shrink-0 mt-0.5" />
                Alertas se ajustam à sua fase e às suas condições de saúde.
              </li>
              <li className="flex gap-1.5">
                <Info className="w-3.5 h-3.5 text-rose-500 shrink-0 mt-0.5" />
                Conteúdo educativo não substitui consulta médica.
              </li>
            </ul>
            <button
              onClick={() => setShowInstallTip(false)}
              className="mt-4 w-full bg-stone-900 text-white text-sm font-semibold py-2.5 rounded-xl"
            >
              Fechar
            </button>
          </div>
        </div>
      )}

      {notice && (
        <div className="fixed bottom-20 inset-x-0 z-[65] flex justify-center px-4 pointer-events-none">
          <div className="bg-stone-900 text-white text-xs font-medium px-4 py-2.5 rounded-full shadow-lg fade-in max-w-sm text-center">
            {notice}
          </div>
        </div>
      )}

      {!profile.onboarded && (
        <WelcomeSheet
          onFinish={(patch) => updateProfile(patch)}
          onSkip={() => updateProfile({ onboarded: true })}
        />
      )}

      {exportOpen && (
        <ExportSheet
          profiles={profiles}
          activeProfileId={activeId}
          onClose={() => setExportOpen(false)}
        />
      )}

      {importOpen && (
        <ImportSheet
          onClose={() => setImportOpen(false)}
          onReplace={handleReplaceImport}
          onMerge={handleMergeImport}
        />
      )}

      {pinSheet && (
        <PinSheet
          mode={pinSheet}
          onClose={() => setPinSheet(null)}
          onDone={handlePinDone}
        />
      )}
    </div>
  );
}