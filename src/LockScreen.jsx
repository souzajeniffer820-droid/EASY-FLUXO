import { useEffect, useRef, useState } from 'react';
import { Lock } from 'lucide-react';
import { PinDots, PinPad } from './PinPad';
import { PIN_LENGTH, MAX_ATTEMPTS, readLockConfig, verifyPin } from './lock';

export default function LockScreen({ onUnlock, onForgot }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);

  const configRef = useRef(readLockConfig());
  const onUnlockRef = useRef(onUnlock);
  onUnlockRef.current = onUnlock;

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setInterval(() => setCooldown((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  useEffect(() => {
    if (pin.length !== PIN_LENGTH || busy || cooldown > 0) return undefined;

    let cancelled = false;
    setBusy(true);

    verifyPin(pin, configRef.current)
      .then((ok) => {
        if (cancelled) return;
        if (ok) {
          onUnlockRef.current();
          return;
        }

        const nextAttempts = attempts + 1;
        setAttempts(nextAttempts);
        setPin('');
        setError('PIN incorreto. Tente novamente.');

        if (nextAttempts >= MAX_ATTEMPTS) {
          setAttempts(0);
          setCooldown(30);
          setError('Muitas tentativas. Aguarde 30 segundos.');
        }
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [pin, busy, cooldown, attempts]);

  const handleDigit = (digit) => {
    if (busy || cooldown > 0 || pin.length >= PIN_LENGTH) return;
    setError('');
    setPin((current) => (current + digit).slice(0, PIN_LENGTH));
  };

  const handleBackspace = () => {
    if (busy || cooldown > 0) return;
    setError('');
    setPin((current) => current.slice(0, -1));
  };

  return (
    <div className="min-h-full bg-stone-50 flex flex-col items-center justify-center px-6 py-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center">
          <div className="w-14 h-14 rounded-2xl bg-rose-600 flex items-center justify-center shadow-lg shadow-rose-200">
            <Lock className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-xl font-bold text-stone-900 mt-4">CicloLivre bloqueado</h1>
          <p className="text-xs text-stone-500 mt-1">Digite seu PIN para acessar seus registros.</p>
        </div>

        <div className="mt-8">
          <PinDots filled={pin.length} error={!!error} />
          <p
            className={`text-center text-xs mt-3 h-4 ${
              error ? 'text-rose-600 font-medium' : 'text-stone-400'
            }`}
            role="status"
            aria-live="polite"
          >
            {cooldown > 0 ? `Aguarde ${cooldown}s` : error || (busy ? 'Verificando…' : ' ')}
          </p>
        </div>

        <div className="mt-6">
          <PinPad
            onDigit={handleDigit}
            onBackspace={handleBackspace}
            disabled={busy || cooldown > 0}
          />
        </div>

        <button
          type="button"
          onClick={onForgot}
          className="mt-6 w-full text-center text-xs font-medium text-stone-500 underline"
        >
          Esqueci o PIN
        </button>

        <p className="mt-4 text-center text-[10px] text-stone-400 leading-relaxed">
          Seus dados continuam apenas neste dispositivo.
        </p>
      </div>
    </div>
  );
}
