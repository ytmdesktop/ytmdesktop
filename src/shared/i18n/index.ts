import { Language } from "../store/schema";
import enUS from "./locales/en-US";
import ptBR from "./locales/pt-BR";
import { TranslationSchema } from "./types";

export const defaultLanguage: Language = "en-US";

export const languageNames: Record<Language, string> = {
  "en-US": "English",
  "pt-BR": "Portugues"
};

export const translations: Record<Language, TranslationSchema> = {
  "en-US": enUS,
  "pt-BR": ptBR
};

export function normalizeLanguage(language: string): Language {
  if (language.toLowerCase().startsWith("pt")) {
    return "pt-BR";
  }

  return defaultLanguage;
}

export function getTranslations(language: Language): TranslationSchema {
  return translations[language] ?? translations[defaultLanguage];
}
