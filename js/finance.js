/*
 * finance.js — Moteur de calcul financier (fonctions pures, sans dépendance UI)
 *
 * Toutes les fonctions sont exposées via l'objet global `Finance`.
 * Aucune ne modifie d'état : elles prennent des entrées et retournent des résultats.
 * Ceci facilite les tests et la réutilisation.
 */
(function (global) {
  "use strict";

  const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;

  /**
   * Mensualité d'un prêt amortissable (hors assurance) — formule des annuités constantes.
   * M = C * (i) / (1 - (1 + i)^-n)   avec i = taux mensuel, n = nombre de mensualités.
   * @param {number} capital   Capital emprunté (€)
   * @param {number} tauxAnnuel Taux nominal annuel (ex: 0.032 pour 3,2 %)
   * @param {number} mois       Durée en mois
   * @returns {number} mensualité hors assurance
   */
  function mensualite(capital, tauxAnnuel, mois) {
    if (capital <= 0 || mois <= 0) return 0;
    const i = tauxAnnuel / 12;
    if (i === 0) return capital / mois; // cas taux zéro (PTZ)
    return (capital * i) / (1 - Math.pow(1 + i, -mois));
  }

  /**
   * Prime d'assurance emprunteur mensuelle.
   * @param {number} capital     Capital assuré (€)
   * @param {number} tauxAnnuel  Taux d'assurance annuel (ex: 0.0034 pour 0,34 %)
   * @param {number} mois        Durée en mois
   * @param {string} base        "initial" (capital initial) ou "restant" (capital restant dû, dégressif)
   * @param {number} quotite     Quotité assurée (1 = 100 %)
   * @returns {{mensuelMoyen:number, total:number, premiereMensualite:number}}
   */
  function assurance(capital, tauxAnnuel, mois, base, quotite) {
    quotite = quotite == null ? 1 : quotite;
    const capAssure = capital * quotite;
    if (base === "restant") {
      // Prime dégressive sur capital restant dû : on simule l'amortissement.
      // Sans taux d'intérêt du prêt ici, on approxime avec un amortissement linéaire
      // du capital pour la base d'assurance (usage courant en 1re approche).
      // Pour plus de précision, la base réelle est fournie via echeancier().
      const primeMensuelleInitiale = (capAssure * tauxAnnuel) / 12;
      // Approximation dégressive linéaire : moyenne = prime initiale / 2 * (1 + 1/mois)
      const total = (primeMensuelleInitiale * (mois + 1)) / 2;
      return {
        mensuelMoyen: total / mois,
        total: total,
        premiereMensualite: primeMensuelleInitiale,
      };
    }
    // Base capital initial (constant sur toute la durée)
    const mensuel = (capAssure * tauxAnnuel) / 12;
    return { mensuelMoyen: mensuel, total: mensuel * mois, premiereMensualite: mensuel };
  }

  /**
   * Tableau d'amortissement d'un prêt (hors assurance).
   * @returns {Array<{mois:number, interet:number, capital:number, restant:number}>}
   */
  function echeancier(capital, tauxAnnuel, mois) {
    const i = tauxAnnuel / 12;
    const m = mensualite(capital, tauxAnnuel, mois);
    let restant = capital;
    const rows = [];
    for (let k = 1; k <= mois; k++) {
      const interet = restant * i;
      let partCapital = m - interet;
      if (k === mois) partCapital = restant; // solde final
      restant = Math.max(0, restant - partCapital);
      rows.push({
        mois: k,
        interet: round2(interet),
        capital: round2(partCapital),
        restant: round2(restant),
      });
    }
    return rows;
  }

  /**
   * Coût total des intérêts d'un prêt amortissable.
   */
  function coutInterets(capital, tauxAnnuel, mois) {
    if (tauxAnnuel === 0) return 0;
    return mensualite(capital, tauxAnnuel, mois) * mois - capital;
  }

  /* -------------------------------------------------------------------------
   *  FRAIS DE NOTAIRE (frais d'acquisition)
   * ---------------------------------------------------------------------- */

  /**
   * Émoluments proportionnels du notaire (barème réglementé dégressif), HT.
   * Tranches en vigueur (arrêté tarifaire notarial).
   */
  function emolumentsNotaire(prix) {
    const tranches = [
      { plafond: 6500, taux: 0.0387 },
      { plafond: 17000, taux: 0.01596 },
      { plafond: 60000, taux: 0.01064 },
      { plafond: Infinity, taux: 0.00799 },
    ];
    let reste = prix;
    let borneBasse = 0;
    let total = 0;
    for (const t of tranches) {
      const largeur = Math.min(reste, t.plafond - borneBasse);
      if (largeur <= 0) break;
      total += largeur * t.taux;
      reste -= largeur;
      borneBasse = t.plafond;
      if (reste <= 0) break;
    }
    return total; // HT
  }

  /**
   * Estimation détaillée des frais d'acquisition ("frais de notaire").
   * @param {number} prix           Prix du bien (hors mobilier) €
   * @param {"neuf"|"ancien"} type  Bien neuf ou ancien
   * @param {number} tauxDMTO       Taux de droits de mutation (surchargeable selon département)
   * @returns {{total, emolumentsHT, emolumentsTVA, droitsMutation, csi, debours, detail:Object, tauxEffectif}}
   */
  function fraisNotaire(prix, type, tauxDMTO) {
    if (prix <= 0) return { total: 0, detail: {} };
    // Droits de mutation : ~5,80 % en ancien (variable selon département),
    // ~0,715 % en neuf (taxe de publicité foncière réduite, la TVA étant dans le prix).
    if (tauxDMTO == null) {
      tauxDMTO = type === "neuf" ? 0.00715 : 0.0580665;
    }
    const emolHT = emolumentsNotaire(prix);
    const emolTVA = emolHT * 0.2;
    const droitsMutation = prix * tauxDMTO;
    const csi = prix * 0.001; // contribution de sécurité immobilière (0,10 %)
    const debours = 1200; // débours et formalités (forfait estimatif)

    const total = emolHT + emolTVA + droitsMutation + csi + debours;
    return {
      total: round2(total),
      emolumentsHT: round2(emolHT),
      emolumentsTVA: round2(emolTVA),
      droitsMutation: round2(droitsMutation),
      csi: round2(csi),
      debours: round2(debours),
      tauxDMTO: tauxDMTO,
      tauxEffectif: total / prix,
      detail: {
        "Émoluments du notaire (HT)": round2(emolHT),
        "TVA sur émoluments (20 %)": round2(emolTVA),
        "Droits de mutation (DMTO)": round2(droitsMutation),
        "Contribution de sécurité immobilière": round2(csi),
        "Débours et formalités (forfait)": round2(debours),
      },
    };
  }

  /* -------------------------------------------------------------------------
   *  FRAIS DE GARANTIE (caution / hypothèque)
   * ---------------------------------------------------------------------- */

  /**
   * Estimation des frais de garantie du prêt.
   * @param {number} montantPret Montant du prêt principal €
   * @param {"caution"|"hypotheque"} type
   * @returns {number}
   */
  function fraisGarantie(montantPret, type) {
    if (montantPret <= 0) return 0;
    if (type === "hypotheque") {
      // Hypothèque / IPPD : ~1,5 % du montant (taxe de publicité foncière, émoluments…)
      return round2(montantPret * 0.015);
    }
    // Caution (ex: Crédit Logement) : ~1,2 % environ (commission + fonds mutuel de garantie),
    // dont une partie partiellement restituable en fin de prêt.
    return round2(montantPret * 0.012 + 200);
  }

  /* -------------------------------------------------------------------------
   *  PTZ — Prêt à Taux Zéro
   * ---------------------------------------------------------------------- */

  /**
   * Calcule l'éligibilité et le montant du PTZ.
   * Paramètres 2025 (barèmes indicatifs à vérifier avec le décret en vigueur).
   * @param {Object} p
   * @param {"A"|"Abis"|"B1"|"B2"|"C"} p.zone
   * @param {number} p.personnes       Nombre d'occupants du logement
   * @param {number} p.revenus         Revenu fiscal de référence N-2 (€)
   * @param {number} p.coutOperation   Coût total de l'opération (prix + frais éligibles) €
   * @param {"neuf"|"ancien"} p.typeBien
   * @param {Object} params            Barèmes PTZ (data.js -> PTZ)
   * @returns {{eligible:boolean, montant:number, tranche:number|null, quotite:number, motif:string, plafondCout:number, revenuRetenu:number}}
   */
  function calculPTZ(p, params) {
    const { zone, personnes, revenus, coutOperation, typeBien } = p;

    // En zones tendues (A, Abis, B1) le PTZ concerne le neuf (et logements sociaux).
    // En zones détendues (B2, C) le neuf est éligible et l'ancien uniquement avec
    // travaux importants (>= 25 % du coût). On modélise ici le neuf + ancien détendu.
    const zoneParams = params.plafondsCout[zone];
    if (!zoneParams) {
      return { eligible: false, montant: 0, tranche: null, quotite: 0, motif: "Zone inconnue." };
    }

    const idx = Math.min(personnes, 5) - 1; // 1..5+ -> index 0..4
    const plafondCout = zoneParams[idx];

    // Coefficient familial pour ramener les plafonds de revenus au foyer.
    const coeff = params.coefficientFamilial[Math.min(personnes, 8)] || params.coefficientFamilial[8];

    // Revenu à prendre en compte = max(RFR N-2 ; coût de l'opération / 9)
    const revenuRetenu = Math.max(revenus, coutOperation / 9);

    // Détermination de la tranche (1 à 4) selon les plafonds de la zone.
    const plafondsRevenu = params.plafondsRevenu[zone].map((v) => v * coeff);
    let tranche = null;
    for (let t = 0; t < plafondsRevenu.length; t++) {
      if (revenuRetenu <= plafondsRevenu[t]) {
        tranche = t + 1;
        break;
      }
    }

    if (tranche === null) {
      return {
        eligible: false,
        montant: 0,
        tranche: null,
        quotite: 0,
        plafondCout,
        revenuRetenu,
        motif: "Revenus supérieurs au plafond de la tranche 4 : non éligible au PTZ.",
      };
    }

    const quotite = params.quotites[typeBien === "neuf" ? "neuf" : "ancien"][tranche - 1];
    const assiette = Math.min(coutOperation, plafondCout);
    const montant = round2(assiette * quotite);

    return {
      eligible: montant > 0,
      montant,
      tranche,
      quotite,
      plafondCout,
      revenuRetenu: round2(revenuRetenu),
      differeAnnees: params.differe[tranche - 1],
      motif:
        montant > 0
          ? `Éligible — tranche ${tranche}, quotité ${(quotite * 100).toFixed(0)} % sur une assiette plafonnée à ${assiette.toLocaleString("fr-FR")} €.`
          : "Montant PTZ nul.",
    };
  }

  /* -------------------------------------------------------------------------
   *  TAEG (approché) — via recherche du taux annulant la VAN des flux
   * ---------------------------------------------------------------------- */

  /**
   * Calcule le TAEG approché à partir des flux mensuels réels.
   * Le capital effectivement reçu = montant du prêt.
   * Les flux sortants = mensualités (crédit + assurance) + frais initiaux (dossier, garantie)
   * intégrés au mois 0 comme diminution du capital reçu.
   * On résout par bissection le taux mensuel r tel que VAN = 0.
   * @param {number} capitalRecu    Montant emprunté (€)
   * @param {number} fraisInitiaux  Frais payés au départ liés au crédit (dossier + garantie) €
   * @param {Array<number>} flux     Flux mensuels sortants (mensualité + assurance) sur n mois
   * @returns {number} TAEG annuel approché
   */
  function taeg(capitalRecu, fraisInitiaux, flux) {
    const net = capitalRecu - fraisInitiaux; // montant réellement mis à disposition
    if (net <= 0) return 0;
    const van = (rMensuel) => {
      let v = -net;
      for (let k = 0; k < flux.length; k++) {
        v += flux[k] / Math.pow(1 + rMensuel, k + 1);
      }
      return v;
    };
    let lo = 0,
      hi = 0.05; // borne haute : 5 %/mois -> ~80 %/an, largement suffisant
    // S'assurer d'un changement de signe
    if (van(lo) < 0) return 0;
    for (let iter = 0; iter < 200; iter++) {
      const mid = (lo + hi) / 2;
      const v = van(mid);
      if (Math.abs(v) < 0.01) {
        return Math.pow(1 + mid, 12) - 1;
      }
      if (v > 0) lo = mid;
      else hi = mid;
    }
    const r = (lo + hi) / 2;
    return Math.pow(1 + r, 12) - 1;
  }

  /* -------------------------------------------------------------------------
   *  SIMULATION COMPLÈTE pour une banque
   * ---------------------------------------------------------------------- */

  /**
   * Simule le financement pour une banque donnée.
   * @param {Object} ctx  Contexte de simulation
   * @returns {Object} résultat détaillé
   */
  function simulerBanque(ctx) {
    const {
      banque, // objet banque (data.js)
      dureeMois, // durée en mois
      montantPrincipal, // capital emprunté à la banque (hors PTZ)
      ptzMontant, // montant PTZ (0 si aucun)
      ptzDureeMois, // durée de remboursement du PTZ
      assuranceTaux, // taux annuel d'assurance
      assuranceBase, // "initial" | "restant"
      assuranceQuotite, // quotité (0..1)
      typeGarantie, // "caution" | "hypotheque"
    } = ctx;

    const tauxCredit = banque.taux(dureeMois);

    // --- Prêt principal (banque) ---
    const mensPrincipal = mensualite(montantPrincipal, tauxCredit, dureeMois);
    const interetsPrincipal = coutInterets(montantPrincipal, tauxCredit, dureeMois);

    // --- PTZ (taux 0) ---
    const mensPTZ = ptzMontant > 0 ? mensualite(ptzMontant, 0, ptzDureeMois) : 0;

    // --- Assurance (calculée sur le capital total emprunté) ---
    const capitalAssure = montantPrincipal + ptzMontant;
    const assur = assurance(capitalAssure, assuranceTaux, dureeMois, assuranceBase, assuranceQuotite);

    // --- Frais de dossier & garantie ---
    const fraisDossier = banque.fraisDossier(montantPrincipal);
    const garantie = fraisGarantie(montantPrincipal, typeGarantie);

    // --- Mensualité totale (première mensualité, PTZ inclus tant qu'il court) ---
    const mensualiteTotale = mensPrincipal + mensPTZ + assur.premiereMensualite;
    // Mensualité après fin éventuelle du PTZ (si PTZ plus court que le prêt principal)
    const mensualiteApresPTZ = mensPrincipal + assur.premiereMensualite;

    // --- Coût total du crédit ---
    const coutAssurance = assur.total;
    const coutTotalCredit = interetsPrincipal + coutAssurance + fraisDossier + garantie;

    // --- TAEG approché (sur le prêt principal, hors PTZ qui est une aide) ---
    const fluxPrincipal = [];
    for (let k = 0; k < dureeMois; k++) {
      fluxPrincipal.push(mensPrincipal + assur.premiereMensualite);
    }
    const taegApprox = taeg(montantPrincipal, fraisDossier + garantie, fluxPrincipal);

    return {
      banqueNom: banque.nom,
      tauxCredit,
      mensPrincipal: round2(mensPrincipal),
      mensPTZ: round2(mensPTZ),
      mensAssurance: round2(assur.premiereMensualite),
      mensualiteTotale: round2(mensualiteTotale),
      mensualiteApresPTZ: round2(mensualiteApresPTZ),
      interetsPrincipal: round2(interetsPrincipal),
      coutAssurance: round2(coutAssurance),
      fraisDossier: round2(fraisDossier),
      garantie: round2(garantie),
      coutTotalCredit: round2(coutTotalCredit),
      taegApprox,
      montantPrincipal: round2(montantPrincipal),
      ptzMontant: round2(ptzMontant),
    };
  }

  global.Finance = {
    round2,
    mensualite,
    assurance,
    echeancier,
    coutInterets,
    emolumentsNotaire,
    fraisNotaire,
    fraisGarantie,
    calculPTZ,
    taeg,
    simulerBanque,
  };
})(typeof window !== "undefined" ? window : globalThis);
