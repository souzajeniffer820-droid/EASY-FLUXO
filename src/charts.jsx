import { useId } from 'react';

function shortDate(dateKey) {
  if (typeof dateKey !== 'string' || dateKey.length < 10) return '';
  return `${dateKey.slice(8, 10)}/${dateKey.slice(5, 7)}`;
}

export function Sparkline({
  points,
  color = '#e11d48',
  height = 120,
  unit = '',
  formatValue = (value) => String(value),
  ariaLabel = 'Gráfico de evolução',
}) {
  const gradientId = `spark-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  if (!points || points.length === 0) return null;

  const width = 320;
  const padX = 12;
  const padY = 16;
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const flat = span === 0;

  const x = (index) =>
    points.length === 1
      ? width / 2
      : padX + (index * (width - padX * 2)) / (points.length - 1);
  const y = (value) => (flat ? height / 2 : height - padY - ((value - min) / span) * (height - padY * 2));

  const line = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(point.value).toFixed(1)}`)
    .join(' ');

  const area =
    points.length > 1
      ? `${line} L${x(points.length - 1).toFixed(1)},${height - padY} L${x(0).toFixed(1)},${
          height - padY
        } Z`
      : '';

  const first = points[0];
  const last = points[points.length - 1];

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label={ariaLabel}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {[0.25, 0.5, 0.75].map((ratio) => (
          <line
            key={ratio}
            x1={padX}
            x2={width - padX}
            y1={padY + ratio * (height - padY * 2)}
            y2={padY + ratio * (height - padY * 2)}
            stroke="#e7e5e4"
            strokeWidth="1"
            strokeDasharray="3 4"
          />
        ))}

        {area && <path d={area} fill={`url(#${gradientId})`} />}
        {line && (
          <path
            d={line}
            fill="none"
            stroke={color}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {points.map((point, index) => (
          <circle
            key={point.key || `${point.date || index}`}
            cx={x(index)}
            cy={y(point.value)}
            r={index === points.length - 1 ? 4 : 2.5}
            fill={index === points.length - 1 ? color : '#fff'}
            stroke={color}
            strokeWidth="2"
          />
        ))}
      </svg>

      <div className="flex items-center justify-between text-[10px] text-stone-500 mt-1">
        <span>
          mín {formatValue(min)}
          {unit}
        </span>
        <span className="text-stone-400">
          {shortDate(first.date)} → {shortDate(last.date)}
        </span>
        <span>
          máx {formatValue(max)}
          {unit}
        </span>
      </div>
    </div>
  );
}
