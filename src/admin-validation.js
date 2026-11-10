import { z } from 'zod';

export const idSchema = z.uuid();
export const text = (length = 120, required = true) => z.string().trim().min(required ? 1 : 0).max(length);
export const slug = text(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase words separated by hyphens.');
export const number = (min = 0, max = 100000000) => z.number().int().min(min).max(max);
export const currency = z.enum(['USD', 'EUR', 'GBP', 'RON', 'CAD', 'AUD']);
export const date = z.iso.datetime({ offset: true });
export const day = z.iso.date();

export function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  error.expose = true;
  throw error;
}

export function input(schema, value) {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const field = issue.path.length ? issue.path.join('.') + ' — ' : '';
  fail(400, field + issue.message);
}

export function id(value) {
  return input(idSchema, value);
}

export function one(result, label) {
  return result.rows[0] ?? fail(404, label + ' was not found.');
}

export function publicUrl(value) {
  if (typeof value !== 'string') return false;
  if (/^\/(?!\/)[A-Za-z0-9._\/-]+$/.test(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

export const safeUrl = text(1800).refine(publicUrl, 'Enter an HTTPS URL or an absolute path on this site.');

export function sendCsv(res, filename, labels, rows) {
  const escape = value => {
    let field = value == null ? '' : String(value instanceof Date ? value.toISOString() : value);
    if (typeof value !== 'number' && /^(?:\s*[=+\-@]|\t|\r|\n)/.test(field)) field = "'" + field;
    return '"' + field.replaceAll('"', '""') + '"';
  };
  res.attachment(filename + '.csv').type('text/csv')
    .send('\ufeff' + [labels, ...rows].map(row => row.map(escape).join(',')).join('\r\n') + '\r\n');
}
