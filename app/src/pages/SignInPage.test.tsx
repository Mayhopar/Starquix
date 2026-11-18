import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SignInPage from './SignInPage';

describe('SignInPage', () => {
  it('renders GitHub and Google sign-in links pointing at the api auth routes', () => {
    render(
      <MemoryRouter>
        <SignInPage />
      </MemoryRouter>
    );
    const github = screen.getByRole('link', { name: /continue with github/i });
    const google = screen.getByRole('link', { name: /continue with google/i });
    expect(github).toHaveAttribute('href', expect.stringContaining('/auth/github'));
    expect(google).toHaveAttribute('href', expect.stringContaining('/auth/google'));
  });

  it('shows an error toast-worthy message when redirected back with ?error=oauth_failed', () => {
    render(
      <MemoryRouter initialEntries={['/sign-in?error=oauth_failed']}>
        <SignInPage />
      </MemoryRouter>
    );
    expect(screen.getByText(/sign-in failed/i)).toBeInTheDocument();
  });
});
