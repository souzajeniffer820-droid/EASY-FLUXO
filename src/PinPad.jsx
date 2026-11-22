import { Delete } from 'lucide-react';
import { PIN_LENGTH } from './lock';

export function PinDots({ filled = 0, length = PIN_LENGTH, error = false }) {
  return (
    <div
      className={`flex items-center justify-center gap-3 ${error ? 'pin-shake' : ''}`}
      aria-hidden="true"
    >
      {Array.from({ length }).map((_, index) => (
        <span
          key={index}
          className={`w-3.5 h-3.5 rounded-full border-2 transition ${
            index < filled ? 'bg-rose-600 border-rose-600' : 'border-stone-300 bg-white'
          }`}
        />
      ))}
    </div>
  );
}

export function PinPad({ onDigit, onBackspace, disabled = false }) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

  return (
    <div className="grid grid-cols-3 gap-2" role="group" aria-label="Teclado numérico">
      {keys.map((key) => (
        <button
          key={key}
          type="button"
          disabled={disabled}
          onClick={() => onDigit(key)}
          className="h-14 rounded-2xl bg-white border border-stone-200 text-xl font-semibold text-stone-800 active:bg-stone-100 disabled:opacity-40"
        >
          {key}
        </button>
      ))}
      <span aria-hidden="true" />
      <button
        type="button"
        disabled={disabled}
        onClick={() => onDigit('0')}
        className="h-14 rounded-2xl bg-white border border-stone-200 text-xl font-semibold text-stone-800 active:bg-stone-100 disabled:opacity-40"
      >
        0
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={onBackspace}
        aria-label="Apagar último dígito"
        className="h-14 rounded-2xl bg-stone-100 border border-stone-200 text-stone-600 flex items-center justify-center active:bg-stone-200 disabled:opacity-40"
      >
        <Delete className="w-5 h-5" />
      </button>
    </div>
  );
}
