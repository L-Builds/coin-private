'use client';

// ============================================================
// Coin Private: Shared UI primitives
// AssetIcon, Sparkline, PctBadge, PriceText (live flash),
// StatusPill, SectionHeader, EmptyState, Skeletons, Keypad, Logo
// ============================================================
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { fmtPrice, fmtPct, fmtUsd, fmtCrypto } from '@/lib/format';

// ------------------------------ Logo ------------------------------
// Brand mark: blue rounded square with the white "C" (matches /logo.svg & favicon)
export function CoinPrivateLogo({ size = 28, withWordmark = true }: { size?: number; withWordmark?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 select-none">
      <svg
        width={size}
        height={size}
        viewBox="0 0 200 200"
        fill="none"
        className="shrink-0"
        style={{ filter: 'drop-shadow(0 3px 10px rgba(0,82,255,0.30))' }}
        aria-hidden
      >
        <rect width="200" height="200" rx="46" fill="#0052FF" />
        <path d="M165.57 82 A68 68 0 1 0 165.57 118 L132.33 118 A37 37 0 1 1 132.33 82 Z" fill="#FFFFFF" />
      </svg>
      {withWordmark && (
        <div className="leading-none">
          <span className="font-semibold tracking-tight text-[15px]">Coin</span>
          <span className="font-normal tracking-tight text-[15px] text-muted-foreground"> Private</span>
        </div>
      )}
    </div>
  );
}

// --------------------------- Asset icon ---------------------------
export function AssetIcon({ symbol, color, size = 40, className }: { symbol: string; color?: string; size?: number; className?: string }) {
  const letter = symbol.slice(0, symbol.length >= 4 ? 1 : symbol.length > 2 ? 2 : 1);
  return (
    <div
      className={cn('rounded-full flex items-center justify-center font-semibold shrink-0', className)}
      style={{
        width: size, height: size,
        background: color
          ? `linear-gradient(135deg, ${color} 0%, ${color}CC 100%)`
          : '#2a2d33',
        fontSize: size * 0.36,
        color: '#fff',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.18)',
      }}
      aria-hidden
    >
      {letter}
    </div>
  );
}

// --------------------------- Sparkline ----------------------------
export function Sparkline({ data, up, width = 96, height = 36, strokeWidth = 2, showDot = false }: {
  data: number[];
  up?: boolean;
  width?: number;
  height?: number;
  strokeWidth?: number;
  showDot?: boolean;
}) {
  const id = useRef(`sp-${Math.random().toString(36).slice(2, 9)}`).current;
  if (!data || data.length < 2) {
    return <div style={{ width, height }} className="rounded bg-muted/40" />;
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const step = width / (data.length - 1);
  const pts = data.map((v, i) => [i * step, height - 3 - ((v - min) / range) * (height - 6)] as const);
  const path = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const area = `${path} L${width},${height} L0,${height} Z`;
  const color = up === false || (up === undefined && data[data.length - 1] < data[0]) ? '#cf202f' : '#05c168';
  const last = pts[pts.length - 1];

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={path} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      {showDot && <circle cx={last[0]} cy={last[1]} r="3" fill={color} />}
    </svg>
  );
}

// ---------------------------- % badge -----------------------------
export function PctBadge({ value, className, showBg = true }: { value: number; className?: string; showBg?: boolean }) {
  const up = value >= 0;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-[13px] font-medium nums rounded-md px-1.5 py-0.5',
        up ? 'text-up' : 'text-destructive',
        showBg && (up ? 'bg-up/10' : 'bg-destructive/10'),
        className
      )}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className={up ? '' : 'rotate-180'}>
        <path d="M5 8.5V1.5M5 1.5L1.5 5M5 1.5L8.5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {fmtPct(Math.abs(value)).replace('+', '')}
    </span>
  );
}

// ------------------- Live price with flash ------------------------
export function PriceText({ price, className, prefix = true, format }: {
  price: number;
  className?: string;
  prefix?: boolean;
  format?: (n: number) => string;
}) {
  // Adjust state during render when the price changes (React-endorsed
  // pattern for deriving state from prop changes): flash color then
  // clears via a timeout effect.
  const [prevPrice, setPrevPrice] = useState(price);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);

  if (price !== prevPrice) {
    setFlash(price > prevPrice ? 'up' : 'down');
    setPrevPrice(price);
  }

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 900);
    return () => clearTimeout(t);
  }, [flash]);

  return (
    <span className={cn('nums', flash === 'up' && 'flash-up', flash === 'down' && 'flash-down', className)}>
      {format ? format(price) : prefix ? fmtPrice(price) : fmtCrypto(price)}
    </span>
  );
}

// --------------------------- Status pill ---------------------------
const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  COMPLETED: { label: 'Completed', cls: 'text-up bg-up/10' },
  EXECUTED: { label: 'Executed', cls: 'text-up bg-up/10' },
  POSTED: { label: 'Posted', cls: 'text-up bg-up/10' },
  APPROVED: { label: 'Approved', cls: 'text-up bg-up/10' },
  ACTIVE: { label: 'Active', cls: 'text-up bg-up/10' },
  PENDING: { label: 'Pending', cls: 'text-warn bg-warn/10' },
  PROCESSING: { label: 'Processing', cls: 'text-warn bg-warn/10' },
  REVIEW: { label: 'In review', cls: 'text-warn bg-warn/10' },
  LISTED: { label: 'Listed', cls: 'text-up bg-up/10' },
  DELISTED: { label: 'Delisted', cls: 'text-muted-foreground bg-muted' },
  REJECTED: { label: 'Rejected', cls: 'text-destructive bg-destructive/10' },
  FAILED: { label: 'Failed', cls: 'text-destructive bg-destructive/10' },
  REVERSED: { label: 'Reversed', cls: 'text-destructive bg-destructive/10' },
  FROZEN: { label: 'Frozen', cls: 'text-destructive bg-destructive/10' },
  CLOSED: { label: 'Closed', cls: 'text-muted-foreground bg-muted' },
  DECLINED: { label: 'Declined', cls: 'text-destructive bg-destructive/10' },
};

export function StatusPill({ status, className }: { status: string; className?: string }) {
  const s = STATUS_MAP[status] ?? { label: status, cls: 'text-muted-foreground bg-muted' };
  return <span className={cn('inline-flex items-center text-[11px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5', s.cls, className)}>{s.label}</span>;
}

// ------------------------- Section header -------------------------
export function SectionHeader({ title, sub, action }: { title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between mb-3 mt-1">
      <div>
        <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>
        {sub && <p className="text-[13px] text-muted-foreground mt-0.5">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

// --------------------------- Empty state ---------------------------
export function EmptyState({ icon, title, body, action }: { icon?: React.ReactNode; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6">
      {icon && (
        <div className="w-12 h-12 rounded-2xl bg-secondary flex items-center justify-center text-muted-foreground mb-4">
          {icon}
        </div>
      )}
      <p className="font-medium text-[15px]">{title}</p>
      {body && <p className="text-[13px] text-muted-foreground mt-1.5 max-w-[320px] leading-relaxed">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// ---------------------------- Skeletons ----------------------------
export function SkeletonBlock({ className }: { className?: string }) {
  return <div className={cn('cp-skeleton', className)} />;
}

// ----------------------------- Keypad ------------------------------
export function Keypad({ onKey, disabled = false }: { onKey: (key: string) => void; disabled?: boolean }) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'];
  return (
    <div className="grid grid-cols-3 gap-1 select-none" aria-label="Amount keypad">
      {keys.map((k) => (
        <button
          key={k}
          type="button"
          disabled={disabled}
          onClick={() => onKey(k)}
          className="h-14 rounded-xl text-[22px] nums text-foreground/90 hover:bg-secondary active:bg-accent transition-colors disabled:opacity-40 flex items-center justify-center"
          aria-label={k === 'back' ? 'Delete' : k}
        >
          {k === 'back' ? (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 5H9l-7 7 7 7h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Z" />
              <path d="m12 9 6 6M18 9l-6 6" />
            </svg>
          ) : k}
        </button>
      ))}
    </div>
  );
}

// -------------------------- Segmented tabs -------------------------
export function SegmentedTabs({ items, value, onChange, className }: {
  items: Array<{ value: string; label: string }>;
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <div className={cn('flex bg-secondary rounded-full p-1 gap-1 w-fit', className)} role="tablist">
      {items.map((it) => (
        <button
          key={it.value}
          role="tab"
          aria-selected={value === it.value}
          onClick={() => onChange(it.value)}
          className={cn(
            'px-4 py-1.5 rounded-full text-[13px] font-medium transition-all',
            value === it.value ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

// --------------------------- Money row -----------------------------
export function MoneyRow({ label, value, hint, strong = false }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <span className={cn('text-[13.5px]', strong ? 'text-foreground font-medium' : 'text-muted-foreground')}>{label}</span>
      <span className="text-right">
        <span className={cn('nums text-[13.5px]', strong ? 'font-semibold' : 'font-medium')}>{value}</span>
        {hint && <span className="text-[12px] text-muted-foreground ml-1.5">{hint}</span>}
      </span>
    </div>
  );
}

// --------------------------- Live badge ----------------------------
export function LiveBadge({ provider, updatedAt }: { provider?: string; updatedAt?: number }) {
  const [ago, setAgo] = useState('');
  useEffect(() => {
    if (!updatedAt) return;
    const tick = () => setAgo(`${Math.max(0, Math.round((Date.now() - updatedAt) / 1000))}s`);
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [updatedAt]);
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground" title={`Provider: ${provider ?? '-'} · updated ${ago} ago`}>
      <span className="w-1.5 h-1.5 rounded-full bg-up live-dot" />
      Live{provider ? ` · ${provider}` : ''}
    </span>
  );
}

// ------------------------- Balance display -------------------------
export function BalanceDisplay({ usd, className, showCents = true }: { usd: number; className?: string; showCents?: boolean }) {
  return (
    <span className={cn('nums font-semibold tracking-tight', className)}>
      {fmtUsd(usd, { maxDigits: showCents ? 2 : 0 })}
    </span>
  );
}
