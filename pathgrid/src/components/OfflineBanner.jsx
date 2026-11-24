import { useEffect, useRef, useState } from 'react';
import { Wifi, WifiOff } from 'lucide-react';
import useOnlineStatus from '../hooks/useOnlineStatus';

export const RECONNECTED_MESSAGE_MS = 4000;

const OFFLINE_MESSAGES = {
  public: "You're offline. Maps you've already opened still work, and routes are calculated on your device.",
  admin: "You're offline. Changes can't be saved until your connection returns.",
};

/**
 * Slim, non-blocking connectivity strip. Shows while offline and briefly
 * confirms when the connection returns. Renders nothing otherwise.
 *
 * @param {{ variant?: 'public' | 'admin' }} props
 */
export default function OfflineBanner({ variant = 'public' }) {
  const isOnline = useOnlineStatus();
  const [showReconnected, setShowReconnected] = useState(false);
  const wasOfflineRef = useRef(!isOnline);

  useEffect(() => {
    if (!isOnline) {
      wasOfflineRef.current = true;
      setShowReconnected(false);
      return undefined;
    }
    if (!wasOfflineRef.current) return undefined;
    wasOfflineRef.current = false;
    setShowReconnected(true);
    const timer = setTimeout(() => setShowReconnected(false), RECONNECTED_MESSAGE_MS);
    return () => clearTimeout(timer);
  }, [isOnline]);

  if (!isOnline) {
    return (
      <p
        role="status"
        aria-live="polite"
        className="flex shrink-0 items-center justify-center gap-2 bg-slate-700 px-3 py-1.5 text-center text-sm font-medium text-white"
      >
        <WifiOff aria-hidden="true" className="h-4 w-4 shrink-0" />
        {OFFLINE_MESSAGES[variant] ?? OFFLINE_MESSAGES.public}
      </p>
    );
  }

  if (showReconnected) {
    return (
      <p
        role="status"
        aria-live="polite"
        className="flex shrink-0 items-center justify-center gap-2 bg-emerald-700 px-3 py-1.5 text-center text-sm font-medium text-white"
      >
        <Wifi aria-hidden="true" className="h-4 w-4 shrink-0" />
        Back online
      </p>
    );
  }

  return null;
}
