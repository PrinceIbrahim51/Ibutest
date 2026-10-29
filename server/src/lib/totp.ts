import { Secret, TOTP } from 'otpauth';
import { APP_NAME } from '@ibutest/shared';

const PERIOD = 30;

function totp(secretBase32: string, label = 'user') {
  return new TOTP({
    issuer: APP_NAME,
    label,
    algorithm: 'SHA1', // Required for compatibility with common authenticator apps.
    digits: 6,
    period: PERIOD,
    secret: Secret.fromBase32(secretBase32),
  });
}

export function generateTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

export function totpUri(secretBase32: string, label: string): string {
  return totp(secretBase32, label).toString();
}

/**
 * Validates a TOTP code (±1 step clock drift) and returns the matched time step so the
 * caller can reject replays of an already used code. Returns null when invalid.
 */
export function verifyTotp(secretBase32: string, code: string, lastUsedStep: number | null): number | null {
  const delta = totp(secretBase32).validate({ token: code, window: 1 });
  if (delta === null) return null;
  const step = Math.floor(Date.now() / 1000 / PERIOD) + delta;
  if (lastUsedStep !== null && step <= lastUsedStep) return null;
  return step;
}
