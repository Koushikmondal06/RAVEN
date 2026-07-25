/** Wallet-signature sign-in + JWT sessions + the two auth middlewares (buyer/contributor session,
 *  contributor-daemon bearer key). No private key ever reaches here — users only sign a nonce. */
import { randomBytes } from 'node:crypto';
import type { RequestHandler, Request } from 'express';
import jwt from 'jsonwebtoken';
import { resolveContributorKey } from './db.js';
import { verifyMessageSignature } from './solana.js';

export type Role = 'buyer' | 'contributor';

const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) throw new Error('SESSION_SECRET is not set');
const secret: string = SESSION_SECRET;

export const NONCE_TTL_MS = 5 * 60_000;

/** The exact string the wallet signs — must match on both ends. */
export const signInMessage = (nonce: string) => `Sign in to RAVEN: ${nonce}`;

export const newNonce = () => randomBytes(16).toString('hex');
export const newContributorKey = () => `rvn_ctb_${randomBytes(24).toString('hex')}`;

/** ed25519 verify of the sign-in message against the claimed Solana pubkey. */
export const verifySignIn = (address: string, nonce: string, signature: string): boolean =>
  verifyMessageSignature(address, signInMessage(nonce), signature);

type SessionClaims = { sub: string; role: Role };
export const signSession = (address: string, role: Role): string =>
  jwt.sign({ role } satisfies { role: Role }, secret, { subject: address, expiresIn: '24h' });

// Request augmentation set by the middlewares below.
type Authed = Request & { address?: string; role?: Role; payoutAddress?: string };

/** Gate for balance-spending buyer/contributor routes: a valid session JWT. */
export const requireSession: RequestHandler = (req, res, next) => {
  const token = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
  try {
    const claims = jwt.verify(token, secret) as SessionClaims;
    const r = req as Authed;
    r.address = claims.sub;
    r.role = claims.role;
    next();
  } catch {
    res.status(401).json({ error: 'sign in first' });
  }
};

/** Gate for the contributor daemon: RAVEN_KEY bearer → payout address resolved server-side. */
export const requireContributorKey: RequestHandler = (req, res, next) => {
  const key = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
  if (!key.startsWith('rvn_ctb_')) {
    res.status(401).json({ error: 'RAVEN_KEY required' });
    return;
  }
  void resolveContributorKey(key)
    .then((payoutAddress) => {
      if (!payoutAddress) {
        res.status(401).json({ error: 'unknown RAVEN_KEY' });
        return;
      }
      (req as Authed).payoutAddress = payoutAddress;
      next();
    })
    .catch(next);
};

export const sessionAddress = (req: Request) => (req as Authed).address as string;
export const sessionRole = (req: Request) => (req as Authed).role as Role;
export const contributorPayout = (req: Request) => (req as Authed).payoutAddress as string;
