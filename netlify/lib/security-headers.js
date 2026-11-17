// The security headers netlify.toml sets on every page ([[headers]] for "/*"). Netlify
// doesn't add those to function responses in production, so functions that serve pages
// (share.js: /bill/…, /member/…, /vote/…) send these. tests/security-headers.test.js keeps
// the two identical: change both together.
export const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self' https://www.gstatic.com https://www.google.com; style-src 'self' 'unsafe-inline' https://www.gstatic.com; font-src 'self'; img-src 'self' data: https://www.congress.gov; connect-src 'self' https://firestore.googleapis.com https://firebaseappcheck.googleapis.com https://content-firebaseappcheck.googleapis.com https://www.google.com; frame-src https://www.google.com https://recaptcha.google.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; upgrade-insecure-requests",
  'X-Frame-Options': "DENY",
  'X-Content-Type-Options': "nosniff",
  'Referrer-Policy': "strict-origin-when-cross-origin",
  'Permissions-Policy': "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
};
