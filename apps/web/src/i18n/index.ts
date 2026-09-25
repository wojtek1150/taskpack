import type { Lang } from '@taskpack/api';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import pl from './pl.json';

export const resources = { pl: { translation: pl }, en: { translation: en } } as const;

export async function initI18n(lng: Lang): Promise<typeof i18n> {
  await i18n.use(initReactI18next).init({
    resources,
    lng,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  document.documentElement.lang = lng;
  i18n.on('languageChanged', (l) => {
    document.documentElement.lang = l;
  });
  return i18n;
}

export default i18n;
