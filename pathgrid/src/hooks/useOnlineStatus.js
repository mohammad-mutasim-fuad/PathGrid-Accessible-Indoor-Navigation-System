import { useSyncExternalStore } from 'react';

const subscribe = (callback) => {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
};

// navigator.onLine is only reliable when it says "offline", so anything other
// than an explicit false counts as online.
const getSnapshot = () => typeof navigator === 'undefined' || navigator.onLine !== false;
const getServerSnapshot = () => true;

/** Live browser connectivity (navigator.onLine + online/offline events). */
export default function useOnlineStatus() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
