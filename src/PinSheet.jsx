import { useState } from 'react';
import { X } from 'lucide-react';
import { PinDots, PinPad } from './PinPad';
import { PIN_LENGTH, disablePin, enablePin, verifyPin } from './lock';

function sheetTitle(mode, step) {
  if (mode === 'disable') return 'Desativar bloqueio';
  if (mode === 'change') {
    if (step === 'current') return 'Digite o PIN atual';
    if (step === 'new') return 'Crie o novo PIN';
    return 'Repita o novo PIN';
  }
  return step === 'confirm' ? 'Repita o PIN' : 'Crie um PIN de 4 dígitos';
}

export default function PinSheet({ mode = 'setup', onClose, onDone }) {
  const initialStep = mode === 'setup' ? 'new' : 'current';
  const [step, setStep] = useState(initialStep);
  const [pin, setPin] = useState('');
  const [firstPin, setFirstPin] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const processPin = async (value) => {
    setBusy(true);
    setError('');

    try {
      if (step === 'current') {
        const ok = await verifyPin(value);
        if (!ok) {
          setPin('');
          setError('PIN incorreto. Tente novamente.');
          return;
        }
        if (mode === 'disable') {
          const result = await disablePin(value);
          if (!result.ok) {
            setPin('');
            setError(result.error);
            return;
          }
          onDone('Bloqueio por PIN desativado.');
          return;
        }
        setStep('new');
        setPin('');
        return;
      }

      if (step === 'new') {
        setFirstPin(value);
        setStep('confirm');
        setPin('');
        return;
      }

      if (value !== firstPin) {
        setFirstPin(null);
        setStep('new');
        setPin('');
        setError('Os PINs não coincidem. Tente novamente.');
        return;
      }

      const result = await enablePin(value);
      if (!result.ok) {
        setPin('');
        setError(result.error);
        return;
      }
      onDone(mode === 'change' ? 'PIN alterado com sucesso.' : 'Bloqueio por PIN ativado.');
    } finally {
      setBusy(false);
    }
  };

  const handleDigit = (digit) => {
    if (busy || pin.length >= PIN_LENGTH) return;
    const next = (pin + digit).slice(0, PIN_LENGTH);
    setError('');
    setPin(next);
    if (next.length === PIN_LENGTH) processPin(next);
  };

  const handleBackspace = () => {
    if (busy) return;
    setError('');
    setPin((current) => current.slice(0, -1));
  };

  return (
    <div className="fixed inset-0 z-[70] bg-stone-900/40 flex items-end justify-center">
      <div
        className="w-full max-w-lg bg-stone-50 rounded-t-3xl sheet-anim"
        role="dialog"
        aria-modal="true"
        aria-label={sheetTitle(mode, step)}
      >
        <div className="flex items-start justify-between px-4 pt-4 pb-2">
          <div>
            <p className="text-[10px] uppercase font-semibold text-stone-400">Segurança</p>
            <h2 className="text-base font-bold text-stone-900">{sheetTitle(mode, step)}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="p-2 rounded-lg bg-stone-200 text-stone-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 pb-6 pt-2">
          <p className="text-xs text-stone-500 leading-relaxed text-center">
            O PIN fica apenas neste dispositivo e não é enviado para nenhum servidor.
          </p>

          <div className="mt-6">
            <PinDots filled={pin.length} error={!!error} />
            <p
              className={`text-center text-xs mt-3 h-4 ${
                error ? 'text-rose-600 font-medium' : 'text-stone-400'
              }`}
              role="status"
              aria-live="polite"
            >
              {error || (busy ? 'Salvando…' : ' ')}
            </p>
          </div>

          <div className="mt-5">
            <PinPad onDigit={handleDigit} onBackspace={handleBackspace} disabled={busy} />
          </div>

          <p className="mt-4 text-[10px] text-stone-400 text-center leading-relaxed">
            Se esquecer o PIN, será necessário limpar os dados do app. Faça backups regularmente.
          </p>
        </div>
      </div>
    </div>
  );
}
