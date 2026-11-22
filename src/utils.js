export function formatDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseDateKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function diffDays(dateA, dateB) {
  const utcA = Date.UTC(dateA.getFullYear(), dateA.getMonth(), dateA.getDate());
  const utcB = Date.UTC(dateB.getFullYear(), dateB.getMonth(), dateB.getDate());
  return Math.floor((utcB - utcA) / (1000 * 60 * 60 * 24));
}

export function calculateBMI(weightKg, heightCm) {
  const w = parseFloat(weightKg);
  const h = parseFloat(heightCm) / 100;
  if (!w || !h || h <= 0) return null;
  const bmi = w / (h * h);
  let label = 'Peso adequado';
  let color = 'text-emerald-700 bg-emerald-50 border-emerald-200';
  if (bmi < 18.5) {
    label = 'Abaixo do peso';
    color = 'text-sky-700 bg-sky-50 border-sky-200';
  } else if (bmi >= 25 && bmi < 30) {
    label = 'Sobrepeso';
    color = 'text-amber-700 bg-amber-50 border-amber-200';
  } else if (bmi >= 30) {
    label = 'Obesidade';
    color = 'text-rose-700 bg-rose-50 border-rose-200';
  }
  return { value: bmi.toFixed(1), label, color };
}

export function formatBR(key, opts = { day: '2-digit', month: '2-digit', year: 'numeric' }) {
  return parseDateKey(key).toLocaleDateString('pt-BR', opts);
}

export function monthTitle(date) {
  const raw = date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export function secondsToClock(total) {
  const s = Math.max(0, Math.floor(total));
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return `${String(m).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

/**
 * Retorna o próximo início de ciclo previsto que ainda não passou.
 * Sem isso, quem fica semanas sem registrar vê a previsão "congelada" no passado.
 */
export function nextCycleStart(lastPeriodStartKey, avgCycleLength, today = new Date()) {
  if (!lastPeriodStartKey) return null;
  const length = Math.max(15, Math.min(120, Number(avgCycleLength) || 28));
  let next = addDays(parseDateKey(lastPeriodStartKey), length);
  let guard = 0;
  while (diffDays(next, today) > 0 && guard < 120) {
    next = addDays(next, length);
    guard += 1;
  }
  return next;
}

export const FLOW_VALUES = ['Escape (Spotting)', 'Leve', 'Moderado', 'Intenso', 'Coágulos'];
