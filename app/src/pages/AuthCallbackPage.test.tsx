import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import AuthCallbackPage from './AuthCallbackPage';
import { getAccessToken, setAccessToken } from '@/auth/tokenStore';

describe('AuthCallbackPage', () => {
  beforeEach(() => {
    setAccessToken(null);
    window.history.replaceState(null, '', '/');
  });

  it('stores the access token from the URL fragment and redirects to /', async () => {
    render(
      <MemoryRouter initialEntries={[{ pathname: '/auth/callback', hash: '#access_token=abc123' }]}>
        <Routes>
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route path="/" element={<div>home</div>} />
        </Routes>
      </MemoryRouter>
    );
    await waitFor(() => expect(getAccessToken()).toBe('abc123'));
  });

  it('does nothing destructive when the fragment is missing', async () => {
    render(
      <MemoryRouter initialEntries={['/auth/callback']}>
        <Routes>
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route path="/" element={<div>home</div>} />
        </Routes>
      </MemoryRouter>
    );
    await waitFor(() => expect(getAccessToken()).toBeNull());
  });
});
