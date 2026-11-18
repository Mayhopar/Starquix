import { useEffect, useState } from 'react';
import { fetchMe, type AuthUser } from './authClient';

export interface UseAuthUserResult {
  user: AuthUser | null;
  loading: boolean;
}

export function useAuthUser(): UseAuthUserResult {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchMe().then((u) => {
      if (!cancelled) {
        setUser(u);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, []);

  return { user, loading };
}
