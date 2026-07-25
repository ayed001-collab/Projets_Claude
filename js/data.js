/*
 * data.js — Données de référence : banques, barèmes PTZ, paramètres notariaux.
 *
 * ⚠️ IMPORTANT — Les taux et frais ci-dessous sont INDICATIFS (marché français,
 * mi-2025 / 2026). Ils varient selon le profil (apport, revenus, reste à vivre),
 * la durée, la région et la politique commerciale du moment.
 * Tous ces paramètres sont MODIFIABLES dans l'interface : le simulateur doit
 * refléter les taux réellement obtenus (barème banque ou proposition de courtier).
 */
(function (global) {
  "use strict";

  /**
   * Barème de taux nominaux par durée (interpolation par paliers).
   * Les taux sont donnés pour 15, 20 et 25 ans (durées de référence du marché).
   * @param {Object<number,number>} grille  { 180: 0.031, 240: 0.033, 300: 0.035 }
   * @returns {(mois:number)=>number}
   */
  function tauxParDuree(grille) {
    const paliers = Object.keys(grille)
      .map(Number)
      .sort((a, b) => a - b);
    return function (mois) {
      // En dessous / au dessus des bornes : on prend la borne la plus proche.
      if (mois <= paliers[0]) return grille[paliers[0]];
      if (mois >= paliers[paliers.length - 1]) return grille[paliers[paliers.length - 1]];
      // Interpolation linéaire entre deux paliers encadrants.
      for (let k = 0; k < paliers.length - 1; k++) {
        const a = paliers[k];
        const b = paliers[k + 1];
        if (mois >= a && mois <= b) {
          const ratio = (mois - a) / (b - a);
          return grille[a] + ratio * (grille[b] - grille[a]);
        }
      }
      return grille[paliers[paliers.length - 1]];
    };
  }

  /**
   * Fabrique une banque à partir d'une configuration éditable.
   */
  function makeBanque(cfg) {
    return {
      id: cfg.id,
      nom: cfg.nom,
      couleur: cfg.couleur,
      grilleTaux: cfg.grilleTaux, // { 180:..., 240:..., 300:... }
      dossierType: cfg.dossierType, // "pourcentage" | "forfait"
      dossierValeur: cfg.dossierValeur, // % (0.01) ou € (900)
      dossierMax: cfg.dossierMax || Infinity,
      taux: tauxParDuree(cfg.grilleTaux),
      fraisDossier: function (montant) {
        if (cfg.dossierType === "pourcentage") {
          return Math.min(montant * cfg.dossierValeur, cfg.dossierMax);
        }
        return cfg.dossierValeur;
      },
    };
  }

  // --- Les 5 banques les plus compétitives (échantillon marché FR, dont SG) ---
  // Taux nominaux hors assurance, indicatifs, bons profils.
  const BANQUES_DEFAUT = [
    {
      id: "sg",
      nom: "Société Générale",
      couleur: "#e2001a",
      grilleTaux: { 180: 0.0315, 240: 0.0335, 300: 0.0355 },
      dossierType: "pourcentage",
      dossierValeur: 0.01,
      dossierMax: 1500,
    },
    {
      id: "ca",
      nom: "Crédit Agricole",
      couleur: "#008d36",
      grilleTaux: { 180: 0.0309, 240: 0.0329, 300: 0.0349 },
      dossierType: "forfait",
      dossierValeur: 900,
    },
    {
      id: "bnp",
      nom: "BNP Paribas",
      couleur: "#00915a",
      grilleTaux: { 180: 0.0319, 240: 0.0339, 300: 0.0359 },
      dossierType: "forfait",
      dossierValeur: 1000,
    },
    {
      id: "ce",
      nom: "Caisse d'Épargne",
      couleur: "#e2001a",
      grilleTaux: { 180: 0.0322, 240: 0.0342, 300: 0.0362 },
      dossierType: "forfait",
      dossierValeur: 950,
    },
    {
      id: "cmut",
      nom: "Crédit Mutuel / CIC",
      couleur: "#005ca9",
      grilleTaux: { 180: 0.0312, 240: 0.0332, 300: 0.0352 },
      dossierType: "forfait",
      dossierValeur: 800,
    },
  ];

  // --- Barèmes PTZ 2025 (indicatifs, à vérifier avec le décret en vigueur) ---
  const PTZ = {
    // Plafonds du coût total de l'opération, par zone et nombre d'occupants (1..5+).
    plafondsCout: {
      Abis: [150000, 210000, 255000, 300000, 345000],
      A: [150000, 210000, 255000, 300000, 345000],
      B1: [135000, 189000, 230000, 270000, 311000],
      B2: [110000, 154000, 187000, 220000, 253000],
      C: [100000, 140000, 170000, 200000, 230000],
    },
    // Plafonds de revenu (RFR) pour 1 personne, par zone, pour les tranches 1 à 4.
    // Multipliés par le coefficient familial pour le foyer.
    plafondsRevenu: {
      Abis: [25000, 31000, 37000, 49000],
      A: [25000, 31000, 37000, 49000],
      B1: [21500, 26000, 30000, 40000],
      B2: [18000, 22500, 27000, 35000],
      C: [15000, 19500, 24000, 31500],
    },
    coefficientFamilial: { 1: 1, 2: 1.4, 3: 1.7, 4: 2.0, 5: 2.3, 6: 2.6, 7: 2.9, 8: 3.2 },
    // Quotités par tranche (part du coût plafonné financée à taux 0).
    quotites: {
      neuf: [0.5, 0.4, 0.4, 0.2],
      ancien: [0.5, 0.4, 0.4, 0.2],
    },
    // Différé de remboursement indicatif (années) par tranche.
    differe: [8, 8, 2, 0],
  };

  global.Data = {
    tauxParDuree,
    makeBanque,
    BANQUES_DEFAUT,
    PTZ,
    // instancie les banques par défaut
    banques: BANQUES_DEFAUT.map(makeBanque),
  };
})(typeof window !== "undefined" ? window : globalThis);
