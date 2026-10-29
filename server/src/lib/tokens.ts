import { SignJWT, jwtVerify } from 'jose';

const ISSUER = 'ibutest';
const AUDIENCE = 'ibutest-api';
const ALG = 'HS256';

export interface AccessClaims {
  sub: string;
  sid: string;
}

export async function signAccessToken(claims: AccessClaims, secret: Uint8Array, ttlSec: number): Promise<string> {
  return new SignJWT({ sid: claims.sid, typ: 'access' })
    .setProtectedHeader({ alg: ALG, typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ttlSec}s`)
    .sign(secret);
}

export async function verifyAccessToken(token: string, secret: Uint8Array): Promise<AccessClaims | null> {
  try {
    // Algorithm, issuer and audience are pinned: "alg: none" and algorithm confusion are rejected.
    const { payload } = await jwtVerify(token, secret, { algorithms: [ALG], issuer: ISSUER, audience: AUDIENCE });
    if (payload.typ !== 'access' || typeof payload.sub !== 'string' || typeof payload.sid !== 'string') return null;
    return { sub: payload.sub, sid: payload.sid };
  } catch {
    return null;
  }
}

/** Short-lived token proving the password step succeeded; only valid for the MFA verify endpoint. */
export async function signMfaToken(userId: string, secret: Uint8Array): Promise<string> {
  return new SignJWT({ typ: 'mfa' })
    .setProtectedHeader({ alg: ALG, typ: 'JWT' })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(`${AUDIENCE}:mfa`)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(secret);
}

export async function verifyMfaToken(token: string, secret: Uint8Array): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: [ALG], issuer: ISSUER, audience: `${AUDIENCE}:mfa` });
    if (payload.typ !== 'mfa' || typeof payload.sub !== 'string') return null;
    return payload.sub;
  } catch {
    return null;
  }
}
