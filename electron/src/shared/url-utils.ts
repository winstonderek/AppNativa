import {
  APP_URL,
  EXTERNAL_PROTOCOLS,
  PRIMARY_HOST,
  PROTOCOL_SCHEME,
  SAFE_WEB_PROTOCOLS,
  STRIPE_CHECKOUT_HOSTS,
} from './constants';

export type UrlClassification =
  | 'primary'
  | 'stripe-checkout'
  | 'external-web'
  | 'external-protocol'
  | 'deep-link'
  | 'blocked';

export function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function isLocalDevHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname.endsWith('.localhost')
  );
}

/** True when the host is the primary Pynn web domain or a subdomain of it. */
export function isPrimaryHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === PRIMARY_HOST || host.endsWith(`.${PRIMARY_HOST}`)) {
    return true;
  }

  // Development against `pnpm dev`: camera, mic and in-app navigation must work
  // on localhost / angelhive.localhost without treating them as external.
  return process.env.NODE_ENV === 'development' && isLocalDevHost(host);
}

export function classifyUrl(raw: string): UrlClassification {
  const parsed = parseUrl(raw);
  if (!parsed) return 'blocked';

  const protocol = parsed.protocol.toLowerCase();

  if (protocol === `${PROTOCOL_SCHEME}:`) {
    return 'deep-link';
  }

  for (const ext of EXTERNAL_PROTOCOLS) {
    if (protocol === ext) {
      return 'external-protocol';
    }
  }

  if (!SAFE_WEB_PROTOCOLS.has(protocol)) {
    return 'blocked';
  }

  if (isPrimaryHost(parsed.hostname)) {
    return 'primary';
  }

  if (isStripeCheckoutHost(parsed.hostname)) {
    return 'stripe-checkout';
  }

  return 'external-web';
}

export function isStripeCheckoutHost(hostname: string): boolean {
  return STRIPE_CHECKOUT_HOSTS.has(hostname.toLowerCase());
}

/**
 * Checkout windows must follow Stripe plus bank 3DS pages (arbitrary HTTPS).
 * Primary-host URLs are handed back to the main window instead.
 */
export function isAllowedCheckoutNavigation(raw: string): boolean {
  const classification = classifyUrl(raw);
  return classification === 'stripe-checkout' || classification === 'external-web';
}

export function isSafeForExternalOpen(raw: string): boolean {
  const classification = classifyUrl(raw);
  return (
    classification === 'external-web' ||
    classification === 'external-protocol' ||
    classification === 'stripe-checkout'
  );
}

export function isAllowedMainNavigation(raw: string): boolean {
  return classifyUrl(raw) === 'primary';
}

/** Popup windows stay on the primary Pynn domain, same as the main window. */
export function isAllowedPopupNavigation(raw: string): boolean {
  return classifyUrl(raw) === 'primary';
}

export function resolveDeepLinkPath(raw: string): string | null {
  const parsed = parseUrl(raw);
  if (!parsed || parsed.protocol !== `${PROTOCOL_SCHEME}:`) {
    return null;
  }

  const path = `${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`;
  if (!path || path === '/') return '/';
  return path.startsWith('/') ? path : `/${path}`;
}

/**
 * Resolves a relative or absolute URL from a notification payload to a URL
 * that is safe to load in the main window. Returns null when it is not on
 * the primary Pynn host.
 */
export function resolveInAppNotificationUrl(raw: string | undefined | null): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('/')) {
    const resolved = `${APP_URL.replace(/\/$/, '')}${trimmed}`;
    return isAllowedMainNavigation(resolved) ? resolved : null;
  }

  return isAllowedMainNavigation(trimmed) ? trimmed : null;
}

export function deepLinkToAppUrl(deepLink: string): string {
  const path = resolveDeepLinkPath(deepLink);
  if (!path) return APP_URL;
  const base = APP_URL.replace(/\/$/, '');
  return `${base}${path}`;
}

export function normalizeUrl(raw: string): string {
  const parsed = parseUrl(raw);
  return parsed ? parsed.href : raw;
}
