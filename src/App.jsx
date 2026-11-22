import React, { useState, useEffect, useMemo } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import {
  Calendar as CalendarIcon,
  Heart,
  Baby,
  Sparkles,
  Activity,
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
  Droplets,
  AlertCircle,
  Info,
  Copy,
  CheckCircle2,
  ShieldCheck,
  Users,
  Stethoscope,
  HelpCircle,
  Smartphone,
  Search,
  Trash2,
  Pencil,
  Share2,
  Sun,
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
} from './utils';

import { computeCycleForecast } from './forecast';

const STORAGE_KEY = 'ciclolivre_v3_profiles';
const ACTIVE_KEY = 'ciclolivre_v3_active';
const PERIOD_FLOWS = ['Leve', 'Moderado', 'Intenso', 'Coágulos'];

/* ------------------------------------------------------------------ */
/* Dados iniciais                                                      */
/* ------------------------------------------------------------------ */

function createProfile(id, name = 'Meu perfil') {
  return {
    id,
    name,
    heightCm: '',
    lifeMode: 'cycle',
    contraceptive: 'none',
    vasectomyConfirmed: false,
    conditions: [],
    defaultCycleLength: 28,
    defaultPeriodLength: 5,
    postpartumDate: formatDateKey(addDays(new Date(), -30)),
    breastfeeding: 'exclusive',
    pregnancyLMP: formatDateKey(addDays(new Date(), -90)),
    logs: {},
    contractions: [],
  };
}

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
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && Object.keys(parsed).length) return parsed;
    }
  } catch (e) {
    console.error(e);
  }
  return { p1: createProfile('p1') };
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
      avgCycleLength: profile.defaultCycleLength || 28,
      avgPeriodLength: profile.defaultPeriodLength || 5,
      variation: 0,
      lastPeriodStart: null,
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
      : profile.defaultCycleLength || 28;

  const avgPeriodLength = Math.round(
    parsedCycles.reduce((acc, c) => acc + c.periodLength, 0) / parsedCycles.length
  );

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

  if (profile.lifeMode === 'perimenopause') {
    const lastStart = analytics.lastPeriodStart
      ? parseDateKey(analytics.lastPeriodStart)
      : addDays(today, -18);
    const cycleDay = Math.max(1, diffDays(lastStart, today) + 1);
    return {
      badge: 'Perimenopausa',
      badgeColor: 'bg-amber-100 text-amber-800',
      headline: `Dia ${cycleDay} do ciclo atual`,
      subtext: 'Ciclos irregulares são esperados nesta fase — sem alertas de atraso.',
      phase: 'perimenopause',
    };
  }

  const lastStart = analytics.lastPeriodStart
    ? parseDateKey(analytics.lastPeriodStart)
    : addDays(today, -10);
  const cycleDay = Math.max(1, diffDays(lastStart, today) + 1);
  const avgLen = analytics.avgCycleLength;
  const ovulDay = Math.max(10, avgLen - 14);
  const daysToNext = avgLen - cycleDay + 1;

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
  } else if (hasPCOS && cycleDay > avgLen) {
    subtext = 'Ciclo alongado (comum na SOP) — alerta rígido de atraso desativado.';
  } else {
    subtext =
      daysToNext > 0
        ? `Próxima menstruação estimada em ${daysToNext} dias (média de ${avgLen} dias).`
        : `Ciclo no dia ${cycleDay} (média habitual de ${avgLen} dias).`;
  }

  return {
    badge: profile.lifeMode === 'ttc' ? 'Tentando Engravidar' : 'Ciclo Menstrual',
    badgeColor:
      profile.lifeMode === 'ttc' ? 'bg-rose-100 text-rose-800' : 'bg-fuchsia-100 text-fuchsia-800',
    headline: `Dia ${cycleDay} do ciclo`,
    subtext,
    phase: 'regular',
    ovulDay,
    avgLen,
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
  text += `• Duração média do ciclo: ${analytics.avgCycleLength} dias\n`;
  text += `• Duração média da menstruação: ${analytics.avgPeriodLength} dias\n`;
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

/* ------------------------------------------------------------------ */
/* Previsão do ciclo (tela inicial)                                    */
/* ------------------------------------------------------------------ */

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

function TodayTab({
  profile,
  analytics,
  status,
  forecast,
  todayLog,
  recommendedArticle,
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
            {analytics.hasRealData ? 'Baseado no seu histórico' : 'Valores padrão'}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-stone-50 border border-stone-100 p-2.5 text-center">
            <p className="text-xl font-bold text-stone-900">{analytics.avgCycleLength}</p>
            <p className="text-[10px] text-stone-500 mt-0.5">dias de ciclo</p>
          </div>
          <div className="rounded-xl bg-stone-50 border border-stone-100 p-2.5 text-center">
            <p className="text-xl font-bold text-stone-900">{analytics.avgPeriodLength}</p>
            <p className="text-[10px] text-stone-500 mt-0.5">dias de fluxo</p>
          </div>
          <div className="rounded-xl bg-stone-50 border border-stone-100 p-2.5 text-center">
            <p className="text-xl font-bold text-stone-900">±{analytics.variation}</p>
            <p className="text-[10px] text-stone-500 mt-0.5">variação</p>
          </div>
        </div>
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
    if (profile.lifeMode === 'pregnant' || profile.lifeMode === 'postpartum') return set;
    if (profile.contraceptive === 'continuous') return set;
    const nextStart = addDays(parseDateKey(analytics.lastPeriodStart), analytics.avgCycleLength);
    for (let i = 0; i < analytics.avgPeriodLength; i += 1) {
      set.add(formatDateKey(addDays(nextStart, i)));
    }
    return set;
  }, [analytics, profile.lifeMode, profile.contraceptive]);

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

        <div className="flex items-center justify-center gap-4 mt-4 pt-3 border-t border-stone-100 text-[10px] text-stone-500">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-rose-500" /> Fluxo
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-amber-400" /> Sintomas
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-rose-100 border border-rose-200" /> Previsão
          </span>
        </div>
      </SectionCard>

      <div className="grid grid-cols-2 gap-3">
        <SectionCard className="!p-3">
          <p className="text-[10px] uppercase font-semibold text-stone-400">Dias de fluxo</p>
          <p className="text-2xl font-bold text-rose-600">{monthStats.flow}</p>
        </SectionCard>
        <SectionCard className="!p-3">
          <p className="text-[10px] uppercase font-semibold text-stone-400">Dias registrados</p>
          <p className="text-2xl font-bold text-stone-800">{monthStats.registered}</p>
        </SectionCard>
      </div>

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

      <SectionCard className="!p-0 overflow-hidden">
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

function ProfileTab({ profiles, activeProfileId, setActiveProfileId, updateProfile, onAddProfile, onDeleteProfile, onAddDemo, onReset }) {
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
              type="number"
              inputMode="numeric"
              value={profile.defaultCycleLength}
              onChange={(e) =>
                updateProfile({ defaultCycleLength: parseInt(e.target.value || '28', 10) })
              }
              className={inputClass}
            />
          </Field>
          <Field label="Menstruação (dias)">
            <input
              type="number"
              inputMode="numeric"
              value={profile.defaultPeriodLength}
              onChange={(e) =>
                updateProfile({ defaultPeriodLength: parseInt(e.target.value || '5', 10) })
              }
              className={inputClass}
            />
          </Field>
        </div>
        <p className="text-[10px] text-stone-400 mt-2 leading-relaxed">
          Usados apenas quando ainda não há histórico suficiente de registros.
        </p>
      </SectionCard>

      <SectionCard>
        <h3 className="text-sm font-bold text-stone-900 mb-2">Dados</h3>
        <div className="space-y-2">
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
  const [profiles, setProfiles] = useState(loadProfiles);
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
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [guideFilter, setGuideFilter] = useState('all');
  const [copied, setCopied] = useState(false);
  const [showInstallTip, setShowInstallTip] = useState(false);

  const [timerRunning, setTimerRunning] = useState(false);
  const [startTime, setStartTime] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [intensity, setIntensity] = useState('Moderada');

  const profile = profiles[activeProfileId] || Object.values(profiles)[0];

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
    } catch (e) {
      console.error(e);
    }
  }, [profiles]);

  useEffect(() => {
    try {
      localStorage.setItem(ACTIVE_KEY, activeProfileId);
    } catch (e) {
      console.error(e);
    }
  }, [activeProfileId]);

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
        if (logOpen) return setLogOpen(false);
        if (selectedArticle) return setSelectedArticle(null);
        if (showInstallTip) return setShowInstallTip(false);
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
  }, [logOpen, selectedArticle, showInstallTip, activeTab]);

  const updateProfile = (patch) => {
    setProfiles((prev) => ({
      ...prev,
      [activeProfileId]: { ...prev[activeProfileId], ...patch },
    }));
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
    const existing = (profile.logs[selectedDateKey] || {})[categoryKey] || [];
    const updated = existing.includes(option)
      ? existing.filter((item) => item !== option)
      : [...existing, option];
    updateProfile({
      logs: {
        ...profile.logs,
        [selectedDateKey]: { ...(profile.logs[selectedDateKey] || {}), [categoryKey]: updated },
      },
    });
  };

  const updateDayField = (field, value) => {
    updateProfile({
      logs: {
        ...profile.logs,
        [selectedDateKey]: { ...(profile.logs[selectedDateKey] || {}), [field]: value },
      },
    });
  };

  const clearDay = () => {
    const nextLogs = { ...profile.logs };
    delete nextLogs[selectedDateKey];
    updateProfile({ logs: nextLogs });
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
    try {
      await navigator.clipboard.writeText(reportText);
    } catch {
      /* clipboard pode falhar em WebView sem permissão */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
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
    setProfiles((prev) => {
      const next = { ...prev };
      delete next[id];
      const remaining = Object.keys(next);
      setActiveProfileId(remaining[0]);
      return next;
    });
  };

  const addDemo = () => {
    const demo = buildDemoData();
    updateProfile({
      logs: { ...(profile.logs || {}), ...demo.logs },
      heightCm: profile.heightCm || demo.heightCm,
    });
  };

  const resetData = () => {
    updateProfile({ logs: {}, contractions: [] });
  };

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
              value={activeProfileId}
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

      <main className="max-w-lg mx-auto px-4 pt-4 pb-24">
        {activeTab === 'today' && (
          <TodayTab
            profile={profile}
            analytics={analytics}
            status={status}
            forecast={forecast}
            todayLog={todayLog}
            recommendedArticle={recommendedArticle}
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
            activeProfileId={activeProfileId}
            setActiveProfileId={setActiveProfileId}
            updateProfile={updateProfile}
            onAddProfile={addProfile}
            onDeleteProfile={deleteProfile}
            onAddDemo={addDemo}
            onReset={resetData}
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
    </div>
  );
}
