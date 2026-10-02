'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/research';

export function SessionControls() {
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const check = () => {
      if (document.visibilityState === 'visible') {
        api<{ username: string }>('auth/session')
          .then((session) => setUsername(session.username))
          .catch(() => {}); // The local-only development server has no login.
      }
    };
    check();
    const timer = window.setInterval(check, 60_000);
    document.addEventListener('visibilitychange', check);
    const restore = (event: PageTransitionEvent) => { if (event.persisted) check(); };
    window.addEventListener('pageshow', restore);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('pageshow', restore);
    };
  }, []);
  if (!username) return null;
  return <>
    {error && <span role="alert" className="status error">{error}</span>}
    <button className="button ghost" disabled={busy} title={`Signed in as ${username}`}
      onClick={async () => {
        setBusy(true);
        setError('');
        try {
          await api('auth/logout', {});
          window.location.reload();
        } catch {
          setError('Unable to sign out. Please try again.');
          setBusy(false);
        }
      }}>{busy ? 'Signing out…' : 'Sign out'}</button>
  </>;
}
