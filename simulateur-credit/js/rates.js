/*
 * rates.js — Fournisseur de taux : chargement, mise à jour et persistance.
 *
 * ⚠️ Rappel technique important
 * Un navigateur NE PEUT PAS lire directement le contenu des sites des banques
 * (politique CORS + les banques ne publient pas de taux personnalisés exploitables).
 * Ce module se branche donc sur un FLUX JSON configurable (`feedUrl`) que vous
 * alimentez vous-même : saisie manuelle, export d'un agrégateur/courtier disposant
 * d'une API CORS, ou petit script serveur (exécuté hors navigateur) qui agrège les
 * barèmes. À défaut de flux, un barème embarqué daté sert de valeur de départ,
 * et chaque banque pointe vers sa page officielle de barème pour vérification.
 */
(function (global) {
  "use strict";

  // Pages officielles / de référence où consulter les barèmes de chaque banque.
  const SOURCES = {
    sg: { nom: "Société Générale", url: "https://particuliers.sg.fr/credit-immobilier" },
    ca: { nom: "Crédit Agricole", url: "https://www.credit-agricole.fr/particulier/credit/credit-immobilier.html" },
    bnp: { nom: "BNP Paribas", url: "https://mabanque.bnpparibas/fr/credits/credit-immobilier" },
    ce: { nom: "Caisse d'Épargne", url: "https://www.caisse-epargne.fr/particuliers/credit-immobilier/" },
    cmut: { nom: "Crédit Mutuel / CIC", url: "https://www.creditmutuel.fr/fr/particuliers/credits/pret-immobilier.html" },
  };

  // Barème embarqué de secours (indicatif, mi-2025 / 2026). Sert si aucun flux
  // n'est configuré et si rien n'est mémorisé en local.
  const BAREME_EMBARQUE = {
    dateMaj: "2026-06-30",
    origine: "Barème embarqué (indicatif)",
    banques: {
      sg: { 180: 3.15, 240: 3.35, 300: 3.55 },
      ca: { 180: 3.09, 240: 3.29, 300: 3.49 },
      bnp: { 180: 3.19, 240: 3.39, 300: 3.59 },
      ce: { 180: 3.22, 240: 3.42, 300: 3.62 },
      cmut: { 180: 3.12, 240: 3.32, 300: 3.52 },
    },
  };

  const STORAGE_KEY = "simu-credit-taux-v1";

  // Flux de taux par défaut : fichier JSON du dépôt, servi par GitHub raw (CORS activé).
  // Le bouton « ⟳ Mettre à jour » l'utilise sans configuration.
  // NB : fonctionne partout où les requêtes externes sont permises (local, GitHub Pages,
  // hébergement classique). Le lien Artifact hébergé bloque en revanche toute requête
  // externe : là, seule la saisie manuelle (mémorisée) est disponible.
  const DEFAULT_FEED_URL =
    "https://raw.githubusercontent.com/ayed001-collab/Projets_Claude/claude/mortgage-simulator-platform-rjcwyk/simulateur-credit/data/taux.json";

  /**
   * Valide et normalise un flux de taux (structure attendue documentée ci-dessous).
   * Format attendu :
   * {
   *   "dateMaj": "2026-07-20",
   *   "origine": "Nom de la source",
   *   "banques": { "sg": {"180":3.15,"240":3.35,"300":3.55}, ... }  // en %
   * }
   * @returns {{dateMaj, origine, banques}} normalisé (taux en %)
   */
  function valider(flux) {
    if (!flux || typeof flux !== "object" || !flux.banques) {
      throw new Error("Flux invalide : clé « banques » manquante.");
    }
    const banques = {};
    for (const [id, grille] of Object.entries(flux.banques)) {
      if (!grille) continue;
      const g = {};
      for (const d of [180, 240, 300]) {
        const v = Number(grille[d]);
        if (Number.isFinite(v) && v > 0 && v < 25) g[d] = v; // garde-fou de plausibilité
      }
      if (Object.keys(g).length) banques[id] = g;
    }
    if (!Object.keys(banques).length) {
      throw new Error("Flux invalide : aucun taux exploitable.");
    }
    return {
      dateMaj: flux.dateMaj || new Date().toISOString().slice(0, 10),
      origine: flux.origine || "Flux externe",
      banques,
    };
  }

  /**
   * Récupère un flux de taux depuis une URL (JSON, CORS requis).
   * @param {string} feedUrl
   * @returns {Promise<{dateMaj, origine, banques}>}
   */
  async function chargerDepuisUrl(feedUrl) {
    if (!feedUrl) throw new Error("Aucune URL de flux configurée.");
    let reponse;
    try {
      reponse = await fetch(feedUrl, { cache: "no-store" });
    } catch (e) {
      throw new Error(
        "Requête réseau impossible (CORS, hors ligne, ou hôte bloqué). " +
          "Le navigateur ne peut pas lire directement un site de banque ; " +
          "pointez vers un flux JSON servant les en-têtes CORS."
      );
    }
    if (!reponse.ok) throw new Error("Réponse HTTP " + reponse.status + ".");
    const flux = await reponse.json();
    return valider(flux);
  }

  /** Persistance locale (survit au rechargement). */
  function sauvegarder(etat) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(etat));
    } catch (e) {
      /* localStorage indisponible (mode privé / iframe) : on ignore silencieusement */
    }
  }
  function chargerLocal() {
    try {
      const brut = localStorage.getItem(STORAGE_KEY);
      if (brut) return valider(JSON.parse(brut));
    } catch (e) {
      /* données corrompues : on repart du barème embarqué */
    }
    return null;
  }
  function reinitialiser() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      /* ignore */
    }
  }

  global.Rates = {
    SOURCES,
    BAREME_EMBARQUE,
    DEFAULT_FEED_URL,
    valider,
    chargerDepuisUrl,
    sauvegarder,
    chargerLocal,
    reinitialiser,
    // État initial : local si présent, sinon barème embarqué.
    etatInitial() {
      return chargerLocal() || JSON.parse(JSON.stringify(BAREME_EMBARQUE));
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
