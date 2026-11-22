import { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  FileJson,
  Share2,
  Upload,
  X,
} from 'lucide-react';
import { BACKUP_MAX_BYTES, backupSummary, parseBackup, serializeBackup } from './backup';
import { copyText } from './clipboard';
import { formatDateKey } from './utils';

const sheetClass =
  'w-full max-w-lg bg-stone-50 rounded-t-3xl max-h-[92vh] flex flex-col sheet-anim';

function SheetHeader({ title, subtitle, onClose }) {
  return (
    <div className="flex items-start justify-between px-4 pt-4 pb-2 border-b border-stone-200">
      <div>
        <p className="text-[10px] uppercase font-semibold text-stone-400">{subtitle}</p>
        <h2 className="text-base font-bold text-stone-900">{title}</h2>
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
  );
}

function SensitiveWarning() {
  return (
    <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-900">
      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
      <p className="leading-relaxed">
        O backup contém seus dados de saúde. Guarde o arquivo em um local seguro e não compartilhe
        com outras pessoas.
      </p>
    </div>
  );
}

export function ExportSheet({ profiles, activeProfileId, onClose }) {
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState('');
  const json = useMemo(
    () => serializeBackup(profiles, activeProfileId),
    [profiles, activeProfileId]
  );
  const summary = useMemo(() => backupSummary(profiles), [profiles]);
  const sizeKb = Math.max(1, Math.round(new TextEncoder().encode(json).length / 1024));
  const fileName = `ciclolivre-backup-${formatDateKey(new Date())}.json`;
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const handleCopy = async () => {
    const ok = await copyText(json);
    setCopied(ok);
    setFeedback(ok ? 'Backup copiado.' : 'Não foi possível copiar. Selecione o texto abaixo.');
    if (ok) setTimeout(() => setCopied(false), 2200);
  };

  const handleDownload = () => {
    try {
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      setFeedback('Download iniciado. Se nada acontecer, use "Copiar JSON".');
    } catch {
      setFeedback('Não foi possível baixar o arquivo. Use "Copiar JSON".');
    }
  };

  const handleShare = async () => {
    try {
      await navigator.share({ title: 'Backup CicloLivre', text: json });
    } catch {
      /* usuário cancelou */
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-stone-900/40 flex items-end justify-center">
      <div className={sheetClass} role="dialog" aria-modal="true" aria-label="Exportar backup">
        <SheetHeader title="Exportar backup" subtitle="Seus dados" onClose={onClose} />

        <div className="overflow-y-auto px-4 py-4 space-y-4 pb-6">
          <SensitiveWarning />

          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-white border border-stone-200 p-2.5 text-center">
              <p className="text-lg font-bold text-stone-900">{summary.profiles}</p>
              <p className="text-[10px] text-stone-500">perfil(is)</p>
            </div>
            <div className="rounded-xl bg-white border border-stone-200 p-2.5 text-center">
              <p className="text-lg font-bold text-stone-900">{summary.logDays}</p>
              <p className="text-[10px] text-stone-500">dias registrados</p>
            </div>
            <div className="rounded-xl bg-white border border-stone-200 p-2.5 text-center">
              <p className="text-lg font-bold text-stone-900">{sizeKb} KB</p>
              <p className="text-[10px] text-stone-500">tamanho</p>
            </div>
          </div>

          <div className="space-y-2">
            <button
              type="button"
              onClick={handleDownload}
              className="w-full bg-rose-600 active:bg-rose-700 text-white text-sm font-semibold py-3 rounded-xl flex items-center justify-center gap-2"
            >
              <Download className="w-4 h-4" /> Baixar {fileName}
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={handleCopy}
                className="text-xs font-semibold py-2.5 rounded-xl border border-stone-200 bg-white text-stone-700 flex items-center justify-center gap-2 active:bg-stone-50"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                {copied ? 'Copiado' : 'Copiar JSON'}
              </button>
              {canShare ? (
                <button
                  type="button"
                  onClick={handleShare}
                  className="text-xs font-semibold py-2.5 rounded-xl border border-stone-200 bg-white text-stone-700 flex items-center justify-center gap-2 active:bg-stone-50"
                >
                  <Share2 className="w-4 h-4" /> Compartilhar
                </button>
              ) : (
                <div className="text-[10px] text-stone-400 flex items-center justify-center text-center px-2">
                  Compartilhamento indisponível neste dispositivo.
                </div>
              )}
            </div>
          </div>

          {feedback && (
            <p className="text-[11px] text-center text-stone-600" role="status" aria-live="polite">
              {feedback}
            </p>
          )}

          <details className="rounded-xl bg-white border border-stone-200">
            <summary className="px-3 py-2.5 text-xs font-semibold text-stone-700 cursor-pointer flex items-center gap-2">
              <FileJson className="w-4 h-4 text-stone-400" /> Ver conteúdo do backup
            </summary>
            <pre className="max-h-48 overflow-auto p-3 pt-0 text-[10px] leading-relaxed text-stone-600 whitespace-pre-wrap font-mono">
              {json}
            </pre>
          </details>

          <p className="text-[10px] text-stone-400 text-center leading-relaxed">
            Guarde o arquivo no e-mail, Drive ou outro local seguro. Sem ele, não é possível
            recuperar os registros após desinstalar o app.
          </p>
        </div>
      </div>
    </div>
  );
}

export function ImportSheet({ onClose, onReplace, onMerge }) {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);
  const [reading, setReading] = useState(false);
  const fileRef = useRef(null);

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (file.size > BACKUP_MAX_BYTES) {
      setError('O arquivo é grande demais para ser importado.');
      return;
    }

    setReading(true);
    setError('');
    setPreview(null);

    try {
      const content = await file.text();
      setText(content);
      setFileName(file.name);
    } catch {
      setError('Não foi possível ler o arquivo. Tente copiar e colar o conteúdo.');
    } finally {
      setReading(false);
    }
  };

  const handleValidate = () => {
    const result = parseBackup(text);
    if (!result.ok) {
      setPreview(null);
      setError(result.error);
      return;
    }
    setError('');
    setPreview(result);
  };

  return (
    <div className="fixed inset-0 z-[60] bg-stone-900/40 flex items-end justify-center">
      <div className={sheetClass} role="dialog" aria-modal="true" aria-label="Importar backup">
        <SheetHeader title="Importar backup" subtitle="Restaurar dados" onClose={onClose} />

        <div className="overflow-y-auto px-4 py-4 space-y-4 pb-6">
          <SensitiveWarning />

          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            onChange={handleFile}
            className="hidden"
          />

          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={reading}
            className="w-full border-2 border-dashed border-stone-300 rounded-2xl py-6 flex flex-col items-center gap-2 text-stone-600 active:bg-stone-100 disabled:opacity-50"
          >
            <Upload className="w-6 h-6 text-rose-600" />
            <span className="text-sm font-semibold">
              {reading ? 'Lendo arquivo…' : 'Escolher arquivo .json'}
            </span>
            <span className="text-[10px] text-stone-400">
              {fileName || 'Backup exportado pelo CicloLivre'}
            </span>
          </button>

          <div>
            <label
              htmlFor="backup-paste"
              className="block text-xs font-medium text-stone-500 mb-1"
            >
              Ou cole o conteúdo do backup
            </label>
            <textarea
              id="backup-paste"
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setPreview(null);
                setError('');
              }}
              rows={4}
              placeholder='{"app":"ciclolivre",...}'
              className="w-full text-[11px] font-mono border border-stone-200 rounded-xl px-3 py-2.5 bg-white text-stone-800 focus:outline-none focus:ring-2 focus:ring-rose-400 resize-none"
            />
          </div>

          {error && (
            <div
              className="flex gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-[11px] text-rose-900"
              role="alert"
            >
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <p className="leading-relaxed">{error}</p>
            </div>
          )}

          {!preview ? (
            <button
              type="button"
              onClick={handleValidate}
              disabled={!text.trim() || reading}
              className="w-full bg-stone-900 active:bg-stone-800 text-white text-sm font-semibold py-3 rounded-xl disabled:opacity-40"
            >
              Validar backup
            </button>
          ) : (
            <div className="space-y-3">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                <p className="text-xs font-semibold text-emerald-900">Backup válido</p>
                <p className="text-[11px] text-emerald-800 mt-1 leading-relaxed">
                  {preview.summary.profiles} perfil(is) e {preview.summary.logDays} dia(s) de
                  registro.
                  {preview.exportedAt
                    ? ` Exportado em ${new Date(preview.exportedAt).toLocaleString('pt-BR')}.`
                    : ''}
                </p>
              </div>

              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-900 leading-relaxed">
                <strong>Substituir</strong> apaga os dados atuais deste dispositivo.{' '}
                <strong>Mesclar</strong> mantém o que já existe e adiciona os registros do backup
                (o backup vence em datas iguais).
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => onMerge(preview)}
                  className="text-xs font-semibold py-3 rounded-xl border border-stone-200 bg-white text-stone-700 active:bg-stone-50"
                >
                  Mesclar
                </button>
                <button
                  type="button"
                  onClick={() => onReplace(preview)}
                  className="text-xs font-semibold py-3 rounded-xl bg-rose-600 active:bg-rose-700 text-white"
                >
                  Substituir tudo
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
