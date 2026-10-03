import type { Locale } from "@prisma/client";

const copy = {
  EN: {
    appName: "ERP System",
    overview: "Overview",
    preferences: "Preferences",
    company: "Company",
    switchCompany: "Switch company",
    language: "Language",
    signOut: "Sign out",
    dashboard: "Dashboard",
    workspaceReady: "Your workspace is ready",
    workspaceDescription: "Company identity, access and security are managed here.",
    noBusinessData: "Business modules are not enabled yet.",
    setupTitle: "Create your company workspace",
    setupDescription: "Add a company to start using your secure ERP workspace.",
    save: "Save changes",
    currency: "Currency",
    timeZone: "Time zone",
    yourAccess: "Your access",
    memberSince: "Member since",
    member: "Member",
    secureWorkspace: "Secure multi-company workspace",
    businessModules: "Business modules are not enabled yet.",
    moduleDescription: "Company access, roles, audit history, authentication and language preferences are ready for your organization.",
    preferencesTitle: "Preferences",
    preferencesDescription: "Manage your language and display preferences.",
    languageTitle: "Language",
    languageDescription: "Choose English, Hindi or a bilingual interface.",
    savePreference: "Save preference",
    passwordTitle: "Password",
    passwordDescription: "Changing your password signs out all active sessions.",
    currentPassword: "Current password",
    newPassword: "New password",
    passwordHint: "12+ characters with uppercase, lowercase, a number and a symbol.",
    changePassword: "Change password",
    changingPassword: "Updating…",
    displayName: "Display name",
    legalName: "Legal name",
    optional: "optional",
    gstin: "GSTIN",
    createCompany: "Create company",
    creatingWorkspace: "Creating workspace…",
  },
  HI: {
    appName: "ईआरपी सिस्टम",
    overview: "अवलोकन",
    preferences: "प्राथमिकताएँ",
    company: "कंपनी",
    switchCompany: "कंपनी बदलें",
    language: "भाषा",
    signOut: "साइन आउट",
    dashboard: "डैशबोर्ड",
    workspaceReady: "आपका कार्यक्षेत्र तैयार है",
    workspaceDescription: "कंपनी की जानकारी, पहुँच और सुरक्षा यहाँ प्रबंधित होती है।",
    noBusinessData: "व्यावसायिक मॉड्यूल अभी सक्षम नहीं हैं।",
    setupTitle: "अपना कंपनी कार्यक्षेत्र बनाएँ",
    setupDescription: "सुरक्षित ईआरपी कार्यक्षेत्र शुरू करने के लिए कंपनी जोड़ें।",
    save: "बदलाव सहेजें",
    currency: "मुद्रा",
    timeZone: "समय क्षेत्र",
    yourAccess: "आपकी पहुँच",
    memberSince: "सदस्यता शुरू",
    member: "सदस्य",
    secureWorkspace: "सुरक्षित बहु-कंपनी कार्यक्षेत्र",
    businessModules: "व्यावसायिक मॉड्यूल अभी सक्षम नहीं हैं।",
    moduleDescription: "कंपनी पहुँच, भूमिकाएँ, ऑडिट इतिहास, प्रमाणीकरण और भाषा प्राथमिकताएँ आपके संगठन के लिए तैयार हैं।",
    preferencesTitle: "प्राथमिकताएँ",
    preferencesDescription: "अपनी भाषा और प्रदर्शन प्राथमिकताएँ प्रबंधित करें।",
    languageTitle: "भाषा",
    languageDescription: "अंग्रेज़ी, हिंदी या द्विभाषी इंटरफ़ेस चुनें।",
    savePreference: "प्राथमिकता सहेजें",
    passwordTitle: "पासवर्ड",
    passwordDescription: "पासवर्ड बदलने पर सभी सक्रिय सत्र से साइन आउट हो जाएगा।",
    currentPassword: "वर्तमान पासवर्ड",
    newPassword: "नया पासवर्ड",
    passwordHint: "12+ अक्षर, बड़े और छोटे अक्षर, संख्या और प्रतीक शामिल करें।",
    changePassword: "पासवर्ड बदलें",
    changingPassword: "अपडेट हो रहा है…",
    displayName: "प्रदर्शन नाम",
    legalName: "कानूनी नाम",
    optional: "वैकल्पिक",
    gstin: "जीएसटीआईएन",
    createCompany: "कंपनी बनाएँ",
    creatingWorkspace: "कार्यस्थल बनाया जा रहा है…",
  },
} as const;

export function getDictionary(locale: Locale) {
  if (locale === "HI") return copy.HI;
  if (locale === "BILINGUAL") {
    return Object.fromEntries(
      Object.keys(copy.EN).map((key) => [
        key,
        `${copy.EN[key as keyof typeof copy.EN]} · ${copy.HI[key as keyof typeof copy.HI]}`,
      ]),
    ) as {
      [Key in keyof typeof copy.EN]: string;
    };
  }
  return copy.EN;
}

export function localeLabel(locale: Locale) {
  return { EN: "English", HI: "हिंदी", BILINGUAL: "English · हिंदी" }[locale];
}
