import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PUBLIC_API_URL } from '@/api/client';

const STYLES = `
  html { background: #000; }
  body { background: #000; }
  .sq-auth {
    min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center;
    padding: 32px 18px; color: #e2e8f0;
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    background: radial-gradient(1200px 600px at 50% -10%, rgba(30, 41, 59, 0.55), transparent 70%), #000;
  }
  .sq-auth-logo { font-family: 'KTFRublena', Arial, sans-serif; color: #eab308; letter-spacing: 0.06em; font-size: 20px; text-decoration: none; margin-bottom: 26px; }
  .sq-auth-card {
    width: min(94vw, 400px); border: 1px solid #1a2232; border-radius: 12px;
    background: rgba(8, 12, 20, 0.92); padding: 30px 28px 24px; text-align: center;
  }
  .sq-auth-card h1 { font-family: 'KTFRublena', Arial, sans-serif; font-size: 26px; color: #f1f5f9; margin: 0 0 8px; }
  .sq-auth-sub { font-size: 13.5px; line-height: 1.55; color: #8fa3bd; margin: 0 0 22px; }
  .sq-auth-error {
    font-size: 13px; color: #fca5a5; background: rgba(127, 29, 29, 0.25); border: 1px solid rgba(220, 38, 38, 0.4);
    border-radius: 8px; padding: 10px 12px; margin: 0 0 16px;
  }
  .sq-auth-btn {
    display: flex; align-items: center; justify-content: center; gap: 10px;
    width: 100%; padding: 12px 16px; margin-bottom: 10px;
    font-size: 15px; font-weight: 600; color: #10131a; background: #f1f5f9;
    border: 1px solid #cbd5e1; border-radius: 8px; text-decoration: none;
    transition: transform 0.15s ease, filter 0.15s ease;
  }
  .sq-auth-btn:hover { transform: translateY(-1px); filter: brightness(0.96); }
  .sq-auth-btn:focus-visible { outline: 2px solid #eab308; outline-offset: 3px; }
  .sq-auth-btn svg { flex: 0 0 auto; }
  .sq-auth-note { font-size: 12px; line-height: 1.6; color: #64748b; margin: 16px 0 0; }
  .sq-auth-back { display: inline-block; margin-top: 22px; font-size: 13px; color: #93c5fd; text-decoration: none; }
  .sq-auth-back:hover { text-decoration: underline; }
  @media (prefers-reduced-motion: reduce) { .sq-auth-btn { transition: none; } }
`;

function GitHubMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="#10131a" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

export default function SignInPage() {
  const [searchParams] = useSearchParams();
  const hasError = searchParams.get('error') === 'oauth_failed';

  useEffect(() => {
    document.title = 'Sign in — Starquix';
  }, []);

  return (
    <div className="sq-auth">
      <style>{STYLES}</style>
      <Link to="/landing" className="sq-auth-logo">
        STARQUIX
      </Link>
      <div className="sq-auth-card">
        <h1>Start building</h1>
        <p className="sq-auth-sub">One click and you’re in — we use your Google or GitHub account so there’s no password to manage.</p>
        {hasError && (
          <p role="alert" className="sq-auth-error">
            Sign-in failed. Please try again.
          </p>
        )}
        <a className="sq-auth-btn" href={`${PUBLIC_API_URL}/auth/google`}>
          <GoogleMark />
          Continue with Google
        </a>
        <a className="sq-auth-btn" href={`${PUBLIC_API_URL}/auth/github`}>
          <GitHubMark />
          Continue with GitHub
        </a>
        <p className="sq-auth-note">Free — no credit card. Your projects are stored in your own browser until you publish or export.</p>
      </div>
      <Link to="/landing" className="sq-auth-back">
        ← Back to the tour
      </Link>
    </div>
  );
}
