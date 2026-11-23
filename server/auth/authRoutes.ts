import crypto from 'crypto';
import express, { type Request, type Response } from 'express';
import {
  AuthError,
  OAUTH_STATE_COOKIE_NAME,
  OAUTH_STATE_TTL_SECONDS,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  clearAuthCookie,
  createSessionToken,
  createSignedToken,
  extractBearerToken,
  generatePkcePair,
  getFirebaseAuthorizedDomains,
  getFirebaseClientConfig,
  getGoogleOAuthConfig,
  getRequestOrigin,
  parseCookies,
  setAuthCookie,
  verifyFirebaseIdToken,
  verifyGoogleOAuthIdToken,
  verifySameOriginForCookieMutation,
  verifySignedToken,
  type SessionPayload,
} from './authService';
import { userRepository } from '../repositories/userRepository';

interface OAuthStatePayload {
  state: string;
  codeVerifier: string;
  mode: 'popup' | 'redirect';
  origin: string;
  exp: number;
}

function renderOAuthCallbackHtml(params: {
  success: boolean;
  targetOrigin: string;
  errorCode?: string;
  errorMessage?: string;
  user?: {
    uid: string;
    email: string;
    displayName: string;
    photoURL: string;
    role: string;
  };
}): string {
  const safePayload = JSON.stringify({
    type: 'wcr-oauth-result',
    success: params.success,
    errorCode: params.errorCode || null,
    errorMessage: params.errorMessage || null,
    user: params.user || null,
  }).replace(/</g, '\\u003c');

  const safeTargetOrigin = JSON.stringify(params.targetOrigin).replace(/</g, '\\u003c');
  const titleText = params.success ? 'Google Sign-In Complete' : 'Google Sign-In Issue';
  const headingText = params.success ? 'Signed in to White Collar Realty' : 'Sign-In Not Completed';
  const bodyText = params.success
    ? 'Authentication succeeded. Returning you to the dashboard...'
    : params.errorMessage || 'Authentication could not be completed. You may close this window and retry.';

  // Escape HTML entities for rendered text nodes
  const escapeHtml = (str: string) =>
    str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(titleText)}</title>
    <style>
      body { font-family: system-ui, -apple-system, sans-serif; background: #090e1a; color: #f1f5f9; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 24px; }
      .card { max-width: 420px; width: 100%; background: #0f172a; border: 1px solid #1e293b; border-radius: 16px; padding: 24px; text-align: center; box-shadow: 0 20px 45px rgba(0,0,0,.45); }
      h1 { font-size: 18px; margin: 0 0 10px; color: ${params.success ? '#fbbf24' : '#fb7185'}; }
      p { font-size: 13px; color: #cbd5e1; line-height: 1.5; margin: 0 0 18px; }
      button { background: #f59e0b; color: #020617; border: 0; border-radius: 10px; padding: 10px 16px; font-weight: 700; font-size: 13px; cursor: pointer; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${escapeHtml(headingText)}</h1>
      <p>${escapeHtml(bodyText)}</p>
      <button type="button" onclick="window.close()">Close Window</button>
    </div>
    <script>
      (function () {
        var payload = ${safePayload};
        var targetOrigin = ${safeTargetOrigin};
        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage(payload, targetOrigin);
          }
        } catch (e) {}
        setTimeout(function () {
          try { window.close(); } catch (e) {}
        }, ${params.success ? 350 : 1200});
      })();
    </script>
  </body>
</html>`;
}

export function createAuthRouter() {
  const router = express.Router();

  // 1. Public Auth Diagnostic & Configuration Endpoint (NEVER leaks secrets)
  router.get('/config', async (req: Request, res: Response) => {
    try {
      const currentOrigin = getRequestOrigin(req);
      let currentHostname = 'localhost';
      try {
        currentHostname = new URL(currentOrigin).hostname;
      } catch {
        currentHostname = (req.hostname || 'localhost').split(':')[0];
      }

      const fbConfig = getFirebaseClientConfig();
      const oauthConfig = getGoogleOAuthConfig(req);
      const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
      const authorizedDomains = await getFirebaseAuthorizedDomains(forceRefresh);

      const authorizedDomainsChecked = authorizedDomains.length > 0;
      const isOriginAuthorizedInFirebase = authorizedDomainsChecked
        ? authorizedDomains.some((domain) => {
            const d = domain.toLowerCase();
            const h = currentHostname.toLowerCase();
            return d === h || h.endsWith(`.${d}`);
          })
        : true;

      return res.json({
        firebaseConfigured: Boolean(fbConfig?.apiKey && fbConfig?.projectId),
        firebaseProjectId: fbConfig?.projectId || null,
        firebaseAuthDomain: fbConfig?.authDomain || null,
        currentOrigin,
        currentHostname,
        authorizedDomainsChecked,
        isOriginAuthorizedInFirebase,
        googleOAuthConfigured: oauthConfig.configured,
        googleRedirectUri: oauthConfig.redirectUri,
        recommendedAuthMethod: oauthConfig.configured ? 'oauth2' : 'firebase_popup',
      });
    } catch (err: any) {
      console.error('[Auth] Error building auth config:', err?.message || err);
      return res.status(500).json({ error: 'Failed to inspect authentication configuration.' });
    }
  });

  // 2. Restore / Inspect Active Session
  router.get('/session', async (req: Request, res: Response) => {
    try {
      // Check Bearer token first if provided
      const bearer = extractBearerToken(req);
      if (bearer) {
        try {
          const claims = await verifyFirebaseIdToken(bearer);
          const dbUser = await userRepository.getUserByUid(claims.uid);
          return res.json({
            authenticated: true,
            source: 'bearer',
            user: dbUser || {
              uid: claims.uid,
              email: claims.email,
              displayName: claims.displayName,
              photoURL: claims.photoURL,
              role: 'recruiter',
              emailVerified: claims.emailVerified,
              authProvider: claims.authProvider,
            },
          });
        } catch (err) {
          if (err instanceof AuthError) {
            return res.status(err.status).json({
              authenticated: false,
              user: null,
              code: err.code,
              error: err.message,
            });
          }
          throw err;
        }
      }

      // Otherwise check signed HttpOnly session cookie
      const cookies = parseCookies(req);
      const sessionCookie = cookies[SESSION_COOKIE_NAME];
      if (!sessionCookie) {
        return res.json({ authenticated: false, user: null });
      }

      const payload = verifySignedToken<SessionPayload>(sessionCookie);
      if (!payload || !payload.uid) {
        clearAuthCookie(req, res, SESSION_COOKIE_NAME);
        return res.json({ authenticated: false, user: null, code: 'SESSION_EXPIRED' });
      }

      const dbUser = await userRepository.getUserByUid(payload.uid);
      return res.json({
        authenticated: true,
        source: 'cookie',
        user: dbUser || {
          uid: payload.uid,
          email: payload.email,
          displayName: payload.displayName,
          photoURL: payload.photoURL,
          role: payload.role,
          emailVerified: true,
          authProvider: payload.authProvider,
        },
      });
    } catch (err: any) {
      console.error('[Auth] Session check error:', err?.message || err);
      return res.status(500).json({ authenticated: false, user: null, error: 'Session verification failed.' });
    }
  });

  // 3. Exchange Verified Firebase ID Token for Backend Session & User Upsert
  router.post('/session', async (req: Request, res: Response) => {
    try {
      if (!verifySameOriginForCookieMutation(req)) {
        console.warn('[Auth] Blocked cross-origin POST /api/auth/session request from origin:', req.get('origin'));
        return res.status(403).json({
          code: 'ORIGIN_NOT_ALLOWED',
          error: 'Cross-origin session creation request rejected.',
        });
      }

      const bearer = extractBearerToken(req);
      const bodyToken = typeof req.body?.idToken === 'string' ? req.body.idToken.trim() : '';
      const idToken = bearer || bodyToken;

      if (!idToken) {
        return res.status(401).json({
          code: 'MISSING_TOKEN',
          error: 'Authorization Bearer token is required.',
        });
      }

      const claims = await verifyFirebaseIdToken(idToken);
      const userRecord = await userRepository.upsertUser({
        uid: claims.uid,
        email: claims.email,
        displayName: claims.displayName,
        photoURL: claims.photoURL,
        emailVerified: claims.emailVerified,
        authProvider: claims.authProvider,
      });

      const sessionToken = createSessionToken({
        uid: userRecord.uid,
        email: userRecord.email,
        displayName: userRecord.displayName,
        photoURL: userRecord.photoURL,
        role: userRecord.role,
        authProvider: userRecord.authProvider,
      });

      setAuthCookie(req, res, SESSION_COOKIE_NAME, sessionToken, SESSION_TTL_SECONDS);

      console.info(
        `[Auth] Verified Firebase session established: uid=${userRecord.uid}, email=${userRecord.email}, provider=${userRecord.authProvider}, role=${userRecord.role}`
      );

      return res.json({
        authenticated: true,
        user: userRecord,
      });
    } catch (err: any) {
      if (err instanceof AuthError) {
        console.warn(`[Auth] Token verification failed (${err.code}): ${err.message}`);
        return res.status(err.status).json({
          authenticated: false,
          code: err.code,
          error: err.message,
        });
      }
      console.error('[Auth] Unexpected session creation error:', err);
      return res.status(500).json({
        authenticated: false,
        code: 'INTERNAL_AUTH_ERROR',
        error: 'Unable to establish authenticated session. Please try again.',
      });
    }
  });

  // 4. Secure Logout (Clears Session Cookie)
  router.post('/logout', (req: Request, res: Response) => {
    if (!verifySameOriginForCookieMutation(req)) {
      return res.status(403).json({ code: 'ORIGIN_NOT_ALLOWED', error: 'Invalid request origin.' });
    }

    const cookies = parseCookies(req);
    const existing = cookies[SESSION_COOKIE_NAME]
      ? verifySignedToken<SessionPayload>(cookies[SESSION_COOKIE_NAME])
      : null;

    clearAuthCookie(req, res, SESSION_COOKIE_NAME);
    clearAuthCookie(req, res, OAUTH_STATE_COOKIE_NAME);

    console.info(`[Auth] Session terminated${existing?.email ? ` for ${existing.email}` : ''}.`);
    return res.json({ success: true, authenticated: false });
  });

  // 5. Server-Side Google OAuth 2.0 Initiation (Authorization Code + PKCE)
  router.get('/google', (req: Request, res: Response) => {
    const mode = req.query.mode === 'popup' ? 'popup' : 'redirect';
    const requestOrigin = getRequestOrigin(req);
    const oauthConfig = getGoogleOAuthConfig(req);

    if (!oauthConfig.configured) {
      console.warn('[Auth OAuth2] /api/auth/google called, but GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not configured.');
      const msg =
        'Google OAuth 2.0 backend credentials (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET) are not configured on the server.';
      if (mode === 'popup') {
        return res
          .status(503)
          .send(
            renderOAuthCallbackHtml({
              success: false,
              targetOrigin: requestOrigin,
              errorCode: 'OAUTH_NOT_CONFIGURED',
              errorMessage: msg,
            })
          );
      }
      return res.redirect(`/?auth_error=oauth_not_configured`);
    }

    const state = crypto.randomBytes(24).toString('hex');
    const { codeVerifier, codeChallenge } = generatePkcePair();
    const nowSec = Math.floor(Date.now() / 1000);

    const stateToken = createSignedToken<OAuthStatePayload>({
      state,
      codeVerifier,
      mode,
      origin: requestOrigin,
      exp: nowSec + OAUTH_STATE_TTL_SECONDS,
    });

    setAuthCookie(req, res, OAUTH_STATE_COOKIE_NAME, stateToken, OAUTH_STATE_TTL_SECONDS);

    const authParams = new URLSearchParams({
      client_id: oauthConfig.clientId,
      redirect_uri: oauthConfig.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
      access_type: 'online',
      include_granted_scopes: 'true',
    });

    console.info(
      `[Auth OAuth2] Initiating Google OAuth 2.0 flow: mode=${mode}, redirectUri=${oauthConfig.redirectUri}`
    );

    return res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${authParams.toString()}`);
  });

  // 6. Server-Side Google OAuth 2.0 Callback
  router.get('/google/callback', async (req: Request, res: Response) => {
    const requestOrigin = getRequestOrigin(req);
    const cookies = parseCookies(req);
    const rawStateCookie = cookies[OAUTH_STATE_COOKIE_NAME];
    const storedState = rawStateCookie ? verifySignedToken<OAuthStatePayload>(rawStateCookie) : null;
    const mode = storedState?.mode === 'popup' ? 'popup' : 'redirect';
    const targetOrigin = storedState?.origin || requestOrigin;

    // Clear one-time state cookie immediately
    clearAuthCookie(req, res, OAUTH_STATE_COOKIE_NAME);

    const respondWithError = (errorCode: string, errorMessage: string, status = 400) => {
      console.warn(`[Auth OAuth2] Callback error (${errorCode}): ${errorMessage}`);
      if (mode === 'popup') {
        return res.status(status).send(
          renderOAuthCallbackHtml({
            success: false,
            targetOrigin,
            errorCode,
            errorMessage,
          })
        );
      }
      const q = new URLSearchParams({
        auth_error: errorCode,
        auth_error_message: errorMessage,
      });
      return res.redirect(`/?${q.toString()}`);
    };

    try {
      // Handle explicit Google OAuth error / user cancellation / access denial
      const oauthError = typeof req.query.error === 'string' ? req.query.error : '';
      if (oauthError) {
        const mappedMessage =
          oauthError === 'access_denied'
            ? 'Google Sign-In was cancelled or access was denied.'
            : `Google authentication failed (${oauthError}).`;
        return respondWithError(oauthError, mappedMessage, 400);
      }

      const code = typeof req.query.code === 'string' ? req.query.code : '';
      const returnedState = typeof req.query.state === 'string' ? req.query.state : '';

      if (!storedState || !returnedState || !code) {
        return respondWithError(
          'INVALID_OAUTH_STATE',
          'Missing or expired OAuth state. Please try signing in again.',
          400
        );
      }

      const stateA = Buffer.from(storedState.state);
      const stateB = Buffer.from(returnedState);
      if (stateA.length !== stateB.length || !crypto.timingSafeEqual(stateA, stateB)) {
        return respondWithError(
          'STATE_MISMATCH',
          'OAuth security state verification failed. Please retry sign-in.',
          403
        );
      }

      const oauthConfig = getGoogleOAuthConfig(req);
      if (!oauthConfig.configured) {
        return respondWithError(
          'OAUTH_NOT_CONFIGURED',
          'Google OAuth 2.0 credentials are not configured on the server.',
          503
        );
      }

      // Exchange authorization code for tokens on backend (Client Secret never leaves server)
      const tokenParams = new URLSearchParams({
        code,
        client_id: oauthConfig.clientId,
        client_secret: oauthConfig.clientSecret,
        redirect_uri: oauthConfig.redirectUri,
        grant_type: 'authorization_code',
        code_verifier: storedState.codeVerifier,
      });

      const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: tokenParams.toString(),
      });

      const tokenJson = (await tokenResp.json()) as any;
      if (!tokenResp.ok) {
        const errDetail = tokenJson?.error_description || tokenJson?.error || 'Token exchange failed';
        console.error('[Auth OAuth2] Google token exchange failed:', tokenJson?.error || tokenResp.status);
        return respondWithError('TOKEN_EXCHANGE_FAILED', `Google token exchange failed: ${errDetail}`, 401);
      }

      let verifiedClaims;
      if (typeof tokenJson.id_token === 'string' && tokenJson.id_token) {
        verifiedClaims = await verifyGoogleOAuthIdToken(tokenJson.id_token, oauthConfig.clientId);
      } else if (typeof tokenJson.access_token === 'string' && tokenJson.access_token) {
        const userInfoResp = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
          headers: { Authorization: `Bearer ${tokenJson.access_token}` },
        });
        if (!userInfoResp.ok) {
          return respondWithError('USERINFO_FAILED', 'Unable to fetch Google user profile.', 401);
        }
        const profile = (await userInfoResp.json()) as any;
        if (!profile?.sub || !profile?.email) {
          return respondWithError('MISSING_PROFILE', 'Incomplete Google user profile returned.', 401);
        }
        verifiedClaims = {
          uid: `google_${profile.sub}`,
          email: String(profile.email).trim().toLowerCase(),
          emailVerified: Boolean(profile.email_verified ?? true),
          displayName: profile.name || String(profile.email).split('@')[0],
          photoURL: profile.picture || '',
          authProvider: 'google' as const,
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
        };
      } else {
        return respondWithError('MISSING_ID_TOKEN', 'Google did not return an identity token.', 401);
      }

      const userRecord = await userRepository.upsertUser({
        uid: verifiedClaims.uid,
        email: verifiedClaims.email,
        displayName: verifiedClaims.displayName,
        photoURL: verifiedClaims.photoURL,
        emailVerified: verifiedClaims.emailVerified,
        authProvider: 'google',
      });

      const sessionToken = createSessionToken({
        uid: userRecord.uid,
        email: userRecord.email,
        displayName: userRecord.displayName,
        photoURL: userRecord.photoURL,
        role: userRecord.role,
        authProvider: 'google',
      });

      setAuthCookie(req, res, SESSION_COOKIE_NAME, sessionToken, SESSION_TTL_SECONDS);

      console.info(
        `[Auth OAuth2] Login succeeded: uid=${userRecord.uid}, email=${userRecord.email}, role=${userRecord.role}, mode=${mode}`
      );

      if (mode === 'popup') {
        return res.send(
          renderOAuthCallbackHtml({
            success: true,
            targetOrigin,
            user: {
              uid: userRecord.uid,
              email: userRecord.email,
              displayName: userRecord.displayName,
              photoURL: userRecord.photoURL,
              role: userRecord.role,
            },
          })
        );
      }

      return res.redirect('/?auth_status=success');
    } catch (err: any) {
      if (err instanceof AuthError) {
        return respondWithError(err.code, err.message, err.status);
      }
      console.error('[Auth OAuth2] Unexpected callback error:', err);
      return respondWithError(
        'CALLBACK_ERROR',
        'An unexpected error occurred while completing Google Sign-In.',
        500
      );
    }
  });

  // 7. Sanitized Client Auth Error Telemetry Log Endpoint
  router.post('/log-error', (req: Request, res: Response) => {
    const code = typeof req.body?.code === 'string' ? req.body.code.slice(0, 80) : 'unknown';
    const message = typeof req.body?.message === 'string' ? req.body.message.slice(0, 300) : '';
    const hostname = typeof req.body?.hostname === 'string' ? req.body.hostname.slice(0, 160) : '';
    const method = typeof req.body?.method === 'string' ? req.body.method.slice(0, 40) : 'firebase_popup';

    console.info(
      `[Auth Client Diagnostic] method=${method} code=${code} hostname=${hostname} detail="${message}"`
    );

    return res.json({ logged: true });
  });

  return router;
}
