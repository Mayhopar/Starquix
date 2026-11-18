import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { setAccessToken } from '@/auth/tokenStore';

export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const fragment = new URLSearchParams(location.hash.slice(1));
    const accessToken = fragment.get('access_token');
    if (accessToken) setAccessToken(accessToken);
    navigate('/', { replace: true });
  }, [navigate, location.hash]);

  return null;
}
