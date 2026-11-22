import { useState } from 'react';
import { CheckCircle2, Heart, ShieldCheck } from 'lucide-react';
import { LIFE_MODES } from './data';
import { formatDateKey } from './utils';

const inputClass =
  'w-full text-sm border border-stone-200 rounded-xl px-3 py-2.5 bg-white text-stone-800 focus:outline-none focus:ring-2 focus:ring-rose-400';

function dateFieldFor(mode) {
  if (mode === 'pregnant') return 'pregnancyLMP';
  if (mode === 'postpartum') return 'postpartumDate';
  return 'lastPeriodStart';
}

function dateLabelFor(mode) {
  if (mode === 'pregnant') return 'Data da última menstruação (DUM)';
  if (mode === 'postpartum') return 'Data do parto';
  return 'Quando começou sua última menstruação?';
}

export default function WelcomeSheet({ onFinish, onSkip }) {
  const [lifeMode, setLifeMode] = useState('cycle');
  const [date, setDate] = useState('');
  const [heightCm, setHeightCm] = useState('');
  const [cycleLength, setCycleLength] = useState('28');
  const [error, setError] = useState('');

  const todayKey = formatDateKey(new Date());

  const handleModeChange = (mode) => {
    if (dateFieldFor(mode) !== dateFieldFor(lifeMode)) setDate('');
    setLifeMode(mode);
    setError('');
  };

  const handleFinish = () => {
    const requiresDate = lifeMode === 'pregnant' || lifeMode === 'postpartum';
    if (requiresDate && !date) {
      setError('Informe a data para calcular as semanas.');
      return;
    }
    if (date && date > todayKey) {
      setError('A data não pode estar no futuro.');
      return;
    }

    const length = Number.parseInt(cycleLength, 10);
    const patch = {
      lifeMode,
      onboarded: true,
      heightCm: heightCm.trim(),
      defaultCycleLength: Number.isFinite(length) ? Math.min(120, Math.max(15, length)) : 28,
    };

    if (lifeMode === 'pregnant') patch.pregnancyLMP = date;
    else if (lifeMode === 'postpartum') patch.postpartumDate = date;
    else patch.lastPeriodStart = date || null;

    onFinish(patch);
  };

  return (
    <div className="fixed inset-0 z-[80] bg-stone-900/50 flex items-end sm:items-center justify-center overflow-y-auto">
      <div
        className="w-full max-w-lg bg-stone-50 rounded-t-3xl sm:rounded-3xl max-h-[94vh] flex flex-col sheet-anim"
        role="dialog"
        aria-modal="true"
        aria-label="Boas-vindas ao CicloLivre"
      >
        <div className="px-5 pt-5 pb-3 border-b border-stone-200">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-2xl bg-rose-600 flex items-center justify-center">
              <Heart className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-[10px] uppercase font-semibold text-rose-600">Primeiros passos</p>
              <h1 className="text-lg font-bold text-stone-900 leading-tight">
                Bem-vinda ao CicloLivre
              </h1>
            </div>
          </div>
          <p className="text-xs text-stone-600 mt-3 leading-relaxed">
            Vamos personalizar o app com o seu momento de vida. Leva menos de um minuto e você pode
            ajustar tudo depois no Perfil.
          </p>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-5">
          <div>
            <p className="text-xs font-semibold text-stone-700 mb-2">Sua fase atual</p>
            <div className="space-y-1.5">
              {LIFE_MODES.map((mode) => {
                const Icon = mode.icon;
                const active = lifeMode === mode.id;
                return (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => handleModeChange(mode.id)}
                    aria-pressed={active}
                    className={`w-full flex items-center gap-3 p-2.5 rounded-xl border text-left transition ${
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
                    <span className="flex-1 min-w-0">
                      <span className="block text-xs font-semibold text-stone-900">
                        {mode.label}
                      </span>
                      <span className="block text-[10px] text-stone-500 mt-0.5 truncate">
                        {mode.desc}
                      </span>
                    </span>
                    {active && <CheckCircle2 className="w-4 h-4 text-rose-600 shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label htmlFor="welcome-date" className="block text-xs font-semibold text-stone-700 mb-1">
              {dateLabelFor(lifeMode)}
              {(lifeMode === 'pregnant' || lifeMode === 'postpartum') && (
                <span className="text-rose-600"> *</span>
              )}
            </label>
            <input
              id="welcome-date"
              type="date"
              value={date}
              max={todayKey}
              onChange={(event) => {
                setDate(event.target.value);
                setError('');
              }}
              className={inputClass}
            />
            {lifeMode !== 'pregnant' && lifeMode !== 'postpartum' && (
              <p className="text-[10px] text-stone-400 mt-1">
                Opcional. Ajuda a mostrar o dia do ciclo desde o início.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="welcome-height"
                className="block text-xs font-semibold text-stone-700 mb-1"
              >
                Altura (cm)
              </label>
              <input
                id="welcome-height"
                type="number"
                inputMode="decimal"
                value={heightCm}
                onChange={(event) => setHeightCm(event.target.value)}
                placeholder="165"
                className={inputClass}
              />
            </div>
            <div>
              <label
                htmlFor="welcome-cycle"
                className="block text-xs font-semibold text-stone-700 mb-1"
              >
                Ciclo médio (dias)
              </label>
              <input
                id="welcome-cycle"
                type="number"
                inputMode="numeric"
                value={cycleLength}
                onChange={(event) => setCycleLength(event.target.value)}
                placeholder="28"
                className={inputClass}
              />
            </div>
          </div>

          {error && (
            <p className="text-xs font-medium text-rose-600" role="alert">
              {error}
            </p>
          )}

          <div className="flex gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
            <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
            <p className="text-[11px] text-emerald-900 leading-relaxed">
              Seus dados ficam apenas neste dispositivo. Você pode exportar um backup a qualquer
              momento na aba Perfil.
            </p>
          </div>

          <p className="text-[10px] text-stone-400 leading-relaxed">
            O CicloLivre é educativo e não substitui avaliação médica. Previsões são estimativas
            baseadas no seu histórico.
          </p>
        </div>

        <div className="border-t border-stone-200 px-5 py-3 bg-white rounded-b-3xl pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={handleFinish}
            className="w-full bg-rose-600 active:bg-rose-700 text-white font-semibold text-sm py-3 rounded-xl"
          >
            Começar
          </button>
          <button
            type="button"
            onClick={onSkip}
            className="w-full mt-2 text-xs font-medium text-stone-500 py-2"
          >
            Pular por agora
          </button>
        </div>
      </div>
    </div>
  );
}
