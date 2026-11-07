import { PT } from './locales/pt.js';
import { PT_PT } from './locales/pt-PT.js';
import { RU } from './locales/ru.js';
import { AR } from './locales/ar.js';
import { DE } from './locales/de.js';
import { ES } from './locales/es.js';
import { FR } from './locales/fr.js';
import { HI } from './locales/hi.js';
import { ID } from './locales/id.js';
import { IT } from './locales/it.js';
import { JA } from './locales/ja.js';
import { KO } from './locales/ko.js';
import { PL } from './locales/pl.js';
import { TR } from './locales/tr.js';
import { VI } from './locales/vi.js';
import { ZH } from './locales/zh.js';

const DICT = {
  de: DE,
  es: ES,
  fr: FR,
  hi: HI,
  id: ID,
  it: IT,
  ja: JA,
  ko: KO,
  pl: PL,
  tr: TR,
  vi: VI,
  zh: ZH,
  pt: PT,
  'pt-PT': { ...PT, ...PT_PT },
  ru: RU,
  ar: AR
};

const RTL = new Set(['ar']);

// One source of truth for both the initial selector and the terms-screen picker.
// New language choices follow Harbor's supported app locales. Where the installer
// has no translated copy yet, t() continues to use its English source text.
export const VARIANTS = [
  { code: 'en', label: 'English', english: 'English', flag: 'assets/flags/flag-eng.svg' },
  { code: 'ar', label: 'العربية', english: 'Arabic', flag: 'assets/flags/flag-ara.svg' },
  { code: 'de', label: 'Deutsch', english: 'German', flag: 'assets/flags/flag-de.svg' },
  { code: 'es', label: 'Español', english: 'Spanish', flag: 'assets/flags/flag-es.svg' },
  { code: 'fr', label: 'Français', english: 'French', flag: 'assets/flags/flag-fr.svg' },
  { code: 'hi', label: 'हिन्दी', english: 'Hindi', flag: 'assets/flags/flag-hi.svg' },
  { code: 'id', label: 'Bahasa Indonesia', english: 'Indonesian', flag: 'assets/flags/flag-id.svg' },
  { code: 'it', label: 'Italiano', english: 'Italian', flag: 'assets/flags/flag-it.svg' },
  { code: 'ja', label: '日本語', english: 'Japanese', flag: 'assets/flags/flag-ja.svg' },
  { code: 'ko', label: '한국어', english: 'Korean', flag: 'assets/flags/flag-ko.svg' },
  { code: 'pl', label: 'Polski', english: 'Polish', flag: 'assets/flags/flag-pl.svg' },
  { code: 'pt', label: 'Português (Brasil)', english: 'Portuguese (Brazil)', flag: 'assets/flags/flag-bra.svg' },
  { code: 'pt-PT', label: 'Português (Portugal)', english: 'Portuguese (Portugal)', flag: 'assets/flags/flag-prt.svg' },
  { code: 'ru', label: 'Русский', english: 'Russian', flag: 'assets/flags/flag-rus.svg' },
  { code: 'tr', label: 'Türkçe', english: 'Turkish', flag: 'assets/flags/flag-tr.svg' },
  { code: 'vi', label: 'Tiếng Việt', english: 'Vietnamese', flag: 'assets/flags/flag-vi.svg' },
  { code: 'zh', label: '简体中文', english: 'Chinese (Simplified)', flag: 'assets/flags/flag-zh.svg' }
];

export const CONTINUE_CYCLE = [
  'Continue',
  'Continuar',
  'Продолжить',
  'متابعة'
];

let current = 'en';
const listeners = new Set();

export function getLocale() {
  return current;
}

export function baseLocale(code) {
  return String(code || current).split('-')[0];
}

export function isRTL(code) {
  return RTL.has(baseLocale(code));
}

export function setLocale(code) {
  const next = code === 'en' || Object.hasOwn(DICT, code) ? code : 'en';
  if (next === current) return false;
  current = next;
  const root = document.documentElement;
  root.setAttribute('lang', next);
  root.setAttribute('dir', isRTL(next) ? 'rtl' : 'ltr');
  listeners.forEach((fn) => {
    try {
      fn(next);
    } catch (err) {
      console.error('[harbor-shipyard] locale listener threw', err);
    }
  });
  return true;
}

export function onLocaleChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function t(key, vars) {
  const table = DICT[current];
  let out = (table && table[key]) || key;
  if (vars) {
    Object.keys(vars).forEach((name) => {
      out = out.split('{' + name + '}').join(String(vars[name]));
    });
  }
  return out;
}
