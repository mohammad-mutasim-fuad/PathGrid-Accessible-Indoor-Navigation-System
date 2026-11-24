import { useId } from 'react';
import { CircleAlert, LoaderCircle, RefreshCw } from 'lucide-react';

/** Shared Tailwind class strings for admin buttons. */
export const BUTTON = {
  primary: 'inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 text-sm font-semibold text-white shadow-sm hover:bg-blue-800 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-blue-900 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600 disabled:shadow-none',
  secondary: 'inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-50',
  danger: 'inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-red-700 px-4 text-sm font-semibold text-white shadow-sm hover:bg-red-800 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-red-900 disabled:cursor-not-allowed disabled:opacity-50',
  icon: 'inline-flex h-11 w-11 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-40',
};

export const INPUT = 'h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-blue-700 focus:outline-none focus-visible:ring-3 focus-visible:ring-blue-200';

export function PageHeader({ title, description, actions = null }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-600">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, icon: Icon = null, actions = null, children, className = '' }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      {title && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3">
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
            {Icon && <Icon aria-hidden="true" className="h-5 w-5 text-blue-700" />}
            {title}
          </h2>
          {actions}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

/**
 * Accessible on/off switch.
 * @param {{ checked: boolean, onChange: (v: boolean) => void, label: string,
 *           description?: string, disabled?: boolean, tone?: 'danger'|'primary' }} props
 */
export function Switch({ checked, onChange, label, description = '', disabled = false, tone = 'primary' }) {
  const descriptionId = useId();
  const onColor = tone === 'danger' ? 'bg-red-700 border-red-700' : 'bg-blue-700 border-blue-700';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={description ? descriptionId : undefined}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="inline-flex shrink-0 items-center gap-2 rounded-full focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-wait disabled:opacity-60"
    >
      <span
        aria-hidden="true"
        className={`relative inline-flex h-7 w-12 items-center rounded-full border-2 transition ${
          checked ? onColor : 'border-slate-500 bg-slate-400'
        }`}
      >
        <span
          className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </span>
      {description && <span id={descriptionId} className="sr-only">{description}</span>}
    </button>
  );
}

export function AdminLoading({ label = 'Loading…' }) {
  return (
    <div role="status" className="flex min-h-48 flex-1 items-center justify-center gap-2 text-slate-700">
      <LoaderCircle aria-hidden="true" className="h-6 w-6 animate-spin" />
      {label}
    </div>
  );
}

export function ErrorNotice({ message, onRetry = null }) {
  return (
    <div role="alert" className="flex flex-wrap items-start gap-3 rounded-lg border-2 border-red-700 bg-red-50 px-4 py-3 text-sm text-red-900">
      <CircleAlert aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
      <p className="flex-1 font-medium">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className={BUTTON.secondary}>
          <RefreshCw aria-hidden="true" className="h-4 w-4" />
          Retry
        </button>
      )}
    </div>
  );
}
