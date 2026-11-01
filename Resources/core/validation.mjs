import fs from 'node:fs';
import path from 'node:path';
import { fail } from './errors.mjs';

export const LIMITS = Object.freeze({ inputBytes: 16_384, stateBytes: 1_048_576, accounts: 256, projects: 2_048 });
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function object(value, allowed, required = allowed) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Object.keys(value).some(key => !allowed.includes(key)) ||
      required.some(key => !Object.hasOwn(value, key))) {
    fail('INVALID_INPUT', 'Unexpected or missing object fields.');
  }
  return value;
}

export function text(value, max = 120, allowEmpty = false) {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim()) ||
      /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value)) {
    fail('INVALID_INPUT', 'Invalid text value.');
  }
  return value;
}

export function email(value) {
  if (value === null || value === '') return null;
  text(value, 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)) fail('INVALID_INPUT', 'Invalid email address.');
  return value;
}

export function uuid(value) {
  if (typeof value !== 'string' || !UUID.test(value)) fail('INVALID_INPUT', 'Invalid identifier.');
  return value;
}

export function absolutePath(value) {
  text(value, 4096);
  if (!path.isAbsolute(value) || path.normalize(value) !== value || value === path.parse(value).root) {
    fail('INVALID_PATH', 'An absolute, normalized path is required.');
  }
  return value;
}

export function projectDirectory(value) {
  absolutePath(value);
  try {
    const canonical = fs.realpathSync(value);
    absolutePath(canonical);
    if (!fs.statSync(canonical).isDirectory()) throw new Error();
    fs.accessSync(canonical, fs.constants.R_OK | fs.constants.X_OK);
    return canonical;
  } catch {
    fail('INVALID_DIRECTORY', 'Project directory is missing or inaccessible.');
  }
}

export function executable(value) {
  absolutePath(value);
  try {
    // Official installers commonly expose claude through a symlink.
    const canonical = fs.realpathSync(value);
    absolutePath(canonical);
    if (!fs.statSync(canonical).isFile()) throw new Error();
    fs.accessSync(canonical, fs.constants.X_OK);
    return canonical;
  } catch {
    fail('CLI_NOT_FOUND', 'The configured executable is unavailable.');
  }
}
