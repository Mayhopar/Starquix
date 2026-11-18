import axios from 'axios';

export const PUBLIC_API_URL = import.meta.env.VITE_API_URL || '';

/**
 * Stub API client for browser mode.
 * Image upload and cloud features are not available — requests will fail gracefully.
 */
export const apiClient = axios.create({
  baseURL: PUBLIC_API_URL,
});
