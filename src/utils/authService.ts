import {
  auth,
  googleAuthProvider,
  ensureAuthPersistence,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  type FirebaseUser,
} from './firebase';

export interface AuthenticatedUser {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  role: 'recruiter' | 'admin' | 'hr_manager';
  emailVerified: boolean;
  authProvider: 'google' | 'firebase_google' | 'password';
  createdAt?: string;
  lastLoginAt?: string;
}

export interface AuthConfigStatus {
  firebaseConfigured: boolean;
  firebaseProjectId: string | null;
  firebaseAuthDomain: string | null;
  currentOrigin: string;
  currentHostname: string;
  authorizedDomainsChecked?: boolean;
  isOriginAuthorizedInFirebase: boolean;
  googleOAuthConfigured: boolean;
  googleRedirectUri: string;
  recommendedAuthMethod: 'oauth2' | 'firebase_popup';
}

export interface AuthUiError {
  code: string;
  title: string;
  message: string;
  actionHint?: string;
  isCancellation?: boolean;
}

function reportClientAuthError(code: string, message: string, method: string) {
  try {
    fetch('/api/auth/log-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        message,
        method,
        hostname: typeof window !== 'undefined' ? window.location.hostname : '',
      }),
    }).catch(() => {});
  } catch {
    // non-fatal diagnostic logging
  }
}

export function classifyAuthError(
  err: any,
  method: 'firebase_popup' | 'firebase_redirect' | 'oauth2' = 'firebase_popup'
): AuthUiError {
  const code = String(err?.code || err?.errorCode || 'auth/unknown');
  const rawMessage = String(err?.message || err?.errorMessage || '');
  const hostname = typeof window !== 'undefined' ? window.location.hostname : 'this domain';

  reportClientAuthError(code, rawMessage, method);

  if (
    code === 'auth/popup-closed-by-user' ||
    code === 'auth/cancelled-popup-request' ||
    code === 'access_denied' ||
    code === 'user_cancelled'
  ) {
    return {
      code,
      title: 'Sign-In Cancelled',
      message: 'Google Sign-In was cancelled before completion.',
      actionHint: 'Click "Google Sign-In" whenever you are ready to continue.',
      isCancellation: true,
    };
  }

  if (code === 'auth/popup-blocked' || code === 'popup_blocked') {
    return {
      code,
      title: 'Popup Blocked by Browser',
      message: 'Your browser blocked the Google Sign-In popup window.',
      actionHint: 'Allow popups for this site in your browser bar, or open the app in a new tab and click Retry.',
    };
  }

  if (code === 'auth/unauthorized-domain') {
    return {
      code,
      title: 'Domain Not Authorized for Firebase Sign-In',
      message: `Firebase Auth rejected sign-in because "${hostname}" is not listed under Authorized Domains for this Firebase project.`,
      actionHint: `Add "${hostname}" to Firebase Console -> Authentication -> Settings -> Authorized domains, or configure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server with callback /api/auth/google/callback.`,
    };
  }

  if (code === 'auth/operation-not-allowed') {
    return {
      code,
      title: 'Google Provider Disabled',
      message: 'Google Sign-In provider is not enabled in the Firebase Authentication settings.',
      actionHint: 'Enable the Google sign-in provider in Firebase Console -> Authentication -> Sign-in method.',
    };
  }

  if (code === 'auth/network-request-failed' || code === 'network_error') {
    return {
      code,
      title: 'Network Connection Error',
      message: 'Could not reach Google authentication servers due to a network interruption.',
      actionHint: 'Check your internet connection and retry signing in.',
    };
  }

  if (code === 'auth/user-disabled') {
    return {
      code,
      title: 'Account Disabled',
      message: 'This recruiter account has been disabled by an administrator.',
    };
  }

  if (code === 'auth/id-token-expired' || code === 'TOKEN_EXPIRED' || code === 'SESSION_EXPIRED') {
    return {
      code,
      title: 'Session Expired',
      message: 'Your authentication token expired. Please sign in with Google again.',
    };
  }

  if (code === 'auth/account-exists-with-different-credential') {
    return {
      code,
      title: 'Account Already Exists',
      message: 'An account already exists with this email using a different sign-in method.',
      actionHint: 'Sign in using your original method first.',
    };
  }

  if (code === 'auth/invalid-api-key' || code === 'auth/app-not-authorized') {
    return {
      code,
      title: 'Firebase Configuration Error',
      message: 'The configured Firebase API key or app is not authorized for Google Sign-In.',
      actionHint: 'Verify firebase-applet-config.json matches an active Firebase project you own.',
    };
  }

  return {
    code,
    title: 'Google Sign-In Failed',
    message: rawMessage || 'An unexpected error occurred while signing in with Google.',
    actionHint: 'Please try again. If the issue persists, check the server auth logs.',
  };
}

export async function fetchAuthConfig(forceRefresh = false): Promise<AuthConfigStatus | null> {
  try {
    const url = forceRefresh ? '/api/auth/config?refresh=1' : '/api/auth/config';
    const resp = await fetch(url, {
      method: 'GET',
      credentials: 'include',
    });
    if (!resp.ok) return null;
    return (await resp.json()) as AuthConfigStatus;
  } catch (err) {
    console.warn('[AuthService] Failed to fetch /api/auth/config:', err);
    return null;
  }
}

export async function restoreBackendSession(): Promise<AuthenticatedUser | null> {
  try {
    const resp = await fetch('/api/auth/session', {
      method: 'GET',
      credentials: 'include',
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data?.authenticated && data?.user) {
      return data.user as AuthenticatedUser;
    }
    return null;
  } catch (err) {
    console.warn('[AuthService] Failed to restore backend session:', err);
    return null;
  }
}

export async function syncFirebaseUserWithBackend(
  firebaseUser: FirebaseUser,
  forceRefresh = false
): Promise<AuthenticatedUser> {
  let idToken = await firebaseUser.getIdToken(forceRefresh);

  let resp = await fetch('/api/auth/session', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: JSON.stringify({}),
  });

  // If token just expired, refresh once and retry
  if (resp.status === 401 && !forceRefresh) {
    idToken = await firebaseUser.getIdToken(true);
    resp = await fetch('/api/auth/session', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify({}),
    });
  }

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data?.authenticated || !data?.user) {
    const err: any = new Error(data?.error || 'Backend token verification failed.');
    err.code = data?.code || 'SESSION_SYNC_FAILED';
    throw err;
  }

  return data.user as AuthenticatedUser;
}

function startOAuth2PopupFlow(): Promise<AuthenticatedUser> {
  return new Promise((resolve, reject) => {
    const width = 520;
    const height = 640;
    const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
    const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));

    const popup = window.open(
      '/api/auth/google?mode=popup',
      'wcr_google_oauth',
      `width=${width},height=${height},left=${left},top=${top},menubar=no,toolbar=no,location=yes,status=no`
    );

    if (!popup || popup.closed || typeof popup.closed === 'undefined') {
      // Fallback to top-level redirect if popup blocked and not embedded in an iframe
      if (window.self === window.top) {
        window.location.href = '/api/auth/google?mode=redirect';
        return;
      }
      const err: any = new Error('Browser blocked the Google Sign-In popup.');
      err.code = 'auth/popup-blocked';
      reject(err);
      return;
    }

    let settled = false;
    const expectedOrigin = window.location.origin;

    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      clearInterval(closedCheckTimer);
      clearTimeout(timeoutTimer);
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== expectedOrigin) return;
      const payload = event.data;
      if (!payload || payload.type !== 'wcr-oauth-result') return;

      settled = true;
      cleanup();

      if (payload.success && payload.user) {
        resolve(payload.user as AuthenticatedUser);
      } else {
        const err: any = new Error(payload.errorMessage || 'Google Sign-In did not complete.');
        err.code = payload.errorCode || 'oauth2_failed';
        reject(err);
      }
    };

    const closedCheckTimer = setInterval(() => {
      if (popup.closed && !settled) {
        settled = true;
        cleanup();
        const err: any = new Error('Google Sign-In popup was closed before completing.');
        err.code = 'auth/popup-closed-by-user';
        reject(err);
      }
    }, 450);

    const timeoutTimer = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        try {
          popup.close();
        } catch {}
        const err: any = new Error('Google Sign-In timed out. Please try again.');
        err.code = 'network_error';
        reject(err);
      }
    }, 180_000);

    window.addEventListener('message', onMessage);
  });
}

export async function signInWithGoogleUnified(
  authConfig: AuthConfigStatus | null
): Promise<AuthenticatedUser> {
  // Prefer backend OAuth 2.0 PKCE flow if server credentials are configured
  if (authConfig?.googleOAuthConfigured) {
    return startOAuth2PopupFlow();
  }

  // Primary Firebase Google Sign-In flow via signInWithPopup
  await ensureAuthPersistence();

  try {
    const credential = await signInWithPopup(auth, googleAuthProvider);
    return await syncFirebaseUserWithBackend(credential.user);
  } catch (err: any) {
    const code = String(err?.code || '');
    // Automatic redirect fallback for mobile / Edge / Chrome popup blockers when not embedded in iframe
    if (
      (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') &&
      typeof window !== 'undefined' &&
      window.self === window.top
    ) {
      await signInWithRedirect(auth, googleAuthProvider);
      throw Object.assign(new Error('Redirecting to Google Sign-In...'), { code: 'REDIRECT_IN_PROGRESS' });
    }
    throw err;
  }
}

export async function completeRedirectSignInIfPresent(): Promise<{
  user: AuthenticatedUser | null;
  error: AuthUiError | null;
}> {
  // 1. Check URL query parameters from server OAuth 2.0 redirect mode
  if (typeof window !== 'undefined' && window.location.search) {
    const params = new URLSearchParams(window.location.search);
    const authError = params.get('auth_error');
    const authErrorMsg = params.get('auth_error_message');
    const authStatus = params.get('auth_status');

    if (authError || authStatus) {
      params.delete('auth_error');
      params.delete('auth_error_message');
      params.delete('auth_status');
      const cleaned = params.toString();
      const nextUrl = `${window.location.pathname}${cleaned ? `?${cleaned}` : ''}${window.location.hash}`;
      window.history.replaceState({}, document.title, nextUrl);

      if (authError) {
        return {
          user: null,
          error: classifyAuthError(
            { code: authError, message: authErrorMsg || undefined },
            'oauth2'
          ),
        };
      }
      if (authStatus === 'success') {
        const restored = await restoreBackendSession();
        return { user: restored, error: null };
      }
    }
  }

  // 2. Check Firebase Auth redirect result (mobile / popup-blocked fallback)
  try {
    await ensureAuthPersistence();
    const result = await getRedirectResult(auth);
    if (result?.user) {
      const synced = await syncFirebaseUserWithBackend(result.user);
      return { user: synced, error: null };
    }
  } catch (err: any) {
    return {
      user: null,
      error: classifyAuthError(err, 'firebase_redirect'),
    };
  }

  return { user: null, error: null };
}

export async function signOutUnified(): Promise<void> {
  const errors: any[] = [];

  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify({}),
    });
  } catch (err) {
    errors.push(err);
  }

  try {
    await signOut(auth);
  } catch (err) {
    errors.push(err);
  }

  if (errors.length > 0) {
    console.warn('[AuthService] Logout encountered non-fatal warnings:', errors);
  }
}
