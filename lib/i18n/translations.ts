import type { Locale } from "./types";

const en = {
  meta: {
    title: "Lycapps — iOS Mobile App Development Studio",
    description:
      "Independent studio building polished iOS mobile apps. SkyScore, HyPlan, and more.",
  },
  header: {
    apps: "Apps",
    contact: "Contact",
  },
  hero: {
    eyebrow: "Independent studio",
    title: "Building",
    titleHighlight: "iOS & mobile apps",
    description:
      "Lycapps crafts polished, high-performance mobile apps with user experience at the center. A small studio focused on quality.",
  },
  apps: {
    title: "Our apps",
    subtitle: "Projects currently in development",
    badge: "Coming soon to the App Store",
    items: [
      {
        name: "SkyScore",
        description:
          "Track scores and stats in real time. A smooth experience for enthusiasts.",
      },
      {
        name: "HyPlan",
        description:
          "Plan your day with elegance. Simple organization and a clean interface.",
      },
      {
        name: "Upcoming project",
        description: "More apps are in development. Stay tuned.",
      },
    ],
  },
  contact: {
    title: "Support & Contact",
    description:
      "Have a question, found a bug, or want to share feedback? We're here to help.",
  },
  footer: {
    legalTitle: "Legal notice",
    publisher: "Publisher:",
    publisherDescription: "Independent mobile app development studio.",
    contact: "Contact:",
    privacyPolicy: "Privacy policy",
    copyright: "© 2026 Lycapps. All rights reserved.",
  },
  privacy: {
    metaTitle: "Privacy policy — Lycapps",
    back: "← Back",
    title: "Privacy policy",
    updated: "Last updated: January 2026",
    intro:
      'Lycapps ("we") is committed to protecting the privacy of users of our mobile applications.',
    dataTitle: "Data collected",
    dataBody:
      "Our apps only collect data strictly necessary for their operation. No personal data is sold to third parties.",
    contactTitle: "Contact",
    contactBody: "For any questions about your data:",
  },
};

export type Translations = {
  meta: { title: string; description: string };
  header: { apps: string; contact: string };
  hero: {
    eyebrow: string;
    title: string;
    titleHighlight: string;
    description: string;
  };
  apps: {
    title: string;
    subtitle: string;
    badge: string;
    items: { name: string; description: string }[];
  };
  contact: { title: string; description: string };
  footer: {
    legalTitle: string;
    publisher: string;
    publisherDescription: string;
    contact: string;
    privacyPolicy: string;
    copyright: string;
  };
  privacy: {
    metaTitle: string;
    back: string;
    title: string;
    updated: string;
    intro: string;
    dataTitle: string;
    dataBody: string;
    contactTitle: string;
    contactBody: string;
  };
};

export const translations: Record<Locale, Translations> = {
  en,
  fr: {
    meta: {
      title: "Lycapps — Studio de développement mobile iOS",
      description:
        "Studio indépendant de développement d'applications mobiles iOS. SkyScore, HyPlan et plus.",
    },
    header: {
      apps: "Apps",
      contact: "Contact",
    },
    hero: {
      eyebrow: "Studio indépendant",
      title: "Développement d'applications",
      titleHighlight: "iOS & mobile",
      description:
        "Lycapps conçoit des applications mobiles soignées, performantes et pensées pour l'expérience utilisateur. Un studio à taille humaine, focalisé sur la qualité.",
    },
    apps: {
      title: "Nos applications",
      subtitle: "Projets en cours de développement",
      badge: "Bientôt sur l'App Store",
      items: [
        {
          name: "SkyScore",
          description:
            "Suivez vos scores et statistiques en temps réel. Une expérience fluide pour les passionnés.",
        },
        {
          name: "HyPlan",
          description:
            "Planifiez votre quotidien avec élégance. Organisation simple et interface épurée.",
        },
        {
          name: "Projet à venir",
          description:
            "D'autres applications sont en cours de développement. Restez connectés.",
        },
      ],
    },
    contact: {
      title: "Support & Contact",
      description:
        "Une question, un bug ou une suggestion ? Nous sommes à votre écoute.",
    },
    footer: {
      legalTitle: "Mentions légales",
      publisher: "Éditeur :",
      publisherDescription:
        "Studio indépendant de développement d'applications mobiles.",
      contact: "Contact :",
      privacyPolicy: "Politique de confidentialité",
      copyright: "© 2026 Lycapps. Tous droits réservés.",
    },
    privacy: {
      metaTitle: "Politique de confidentialité — Lycapps",
      back: "← Retour",
      title: "Politique de confidentialité",
      updated: "Dernière mise à jour : janvier 2026",
      intro:
        "Lycapps (« nous ») s'engage à protéger la vie privée des utilisateurs de ses applications mobiles.",
      dataTitle: "Données collectées",
      dataBody:
        "Nos applications ne collectent que les données strictement nécessaires à leur fonctionnement. Aucune donnée personnelle n'est vendue à des tiers.",
      contactTitle: "Contact",
      contactBody: "Pour toute question relative à vos données :",
    },
  },
};

export function getTranslations(locale: Locale): Translations {
  return translations[locale];
}
