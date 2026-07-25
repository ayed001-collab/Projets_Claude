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
   * Estime le taux annuel d'assurance emprunteur d'UN assuré (TAEA indicatif,
   * de type délégation, appliqué au capital assuré).
   *
   * ⚠️ Valeurs INDICATIVES. Les taux réels proviennent des grilles des assureurs
   * et dépendent aussi de l'état de santé (questionnaire médical — supprimé par la
   * loi Lemoine sous 200 000 € par assuré et remboursement avant 60 ans), des
   * garanties souscrites (DC/PTIA, ITT/IPT/IPP) et de la durée.
   *
   * @param {Object} p
   * @param {number} p.age         Âge de l'assuré à la souscription
   * @param {boolean} p.fumeur     Fumeur (inclut vapotage) → surprime
   * @param {string} p.profession  "sedentaire" | "deplacements" | "manuelle" | "risque"
   * @returns {number} taux annuel (fraction, ex : 0.0022 = 0,22 %)
   */
  function tauxAssuranceEmprunteur(p) {
    const age = p && Number.isFinite(p.age) ? p.age : 35;
    // Barème de base par tranche d'âge (non-fumeur, profession sédentaire).
    const bandes = [
      { max: 30, taux: 0.001 },
      { max: 35, taux: 0.0013 },
      { max: 40, taux: 0.0017 },
      { max: 45, taux: 0.0022 },
      { max: 50, taux: 0.003 },
      { max: 55, taux: 0.004 },
      { max: 60, taux: 0.0055 },
      { max: 65, taux: 0.0075 },
      { max: Infinity, taux: 0.01 },
    ];
    let base = bandes[bandes.length - 1].taux;
    for (const b of bandes) {
      if (age <= b.max) {
        base = b.taux;
        break;
      }
    }
    const majFumeur = p && p.fumeur ? 1.6 : 1.0;
    const majProfession =
      { sedentaire: 1.0, deplacements: 1.15, manuelle: 1.35, risque: 1.6 }[
        p && p.profession
      ] || 1.0;
    return base * majFumeur * majProfession;
  }

  /**
   * Taux d'assurance EFFECTIF appliqué au capital, pour 1 à 2 assurés avec quotités.
   * prime = capital × Σ (taux_i × quotité_i). On renvoie donc Σ(taux_i × quotité_i),
   * directement utilisable comme taux unique sur le capital (quotité = 1).
   * @param {Array<{age,fumeur,profession,quotite}>} assures  quotite en fraction (1 = 100 %)
   * @returns {{tauxEffectif:number, detail:Array<{taux:number, quotite:number}>}}
   */
  function tauxAssuranceEffectif(assures) {
    const detail = (assures || []).map((a) => ({
      taux: tauxAssuranceEmprunteur(a),
      quotite: Number.isFinite(a.quotite) ? a.quotite : 1,
    }));
    const tauxEffectif = detail.reduce((s, d) => s + d.taux * d.quotite, 0);
    return { tauxEffectif, detail };
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

  /**
   * Tableau d'amortissement DÉTAILLÉ combinant le prêt principal, le PTZ et l'assurance.
   * Chaque ligne = un mois avec la ventilation intérêts / capital / assurance et
   * le capital restant dû global.
   * @returns {Array<{mois, interet, capitalPrincipal, capitalPTZ, assurance, mensualite, restant}>}
   */
  function echeancierDetaille(opts) {
    const {
      montantPrincipal,
      tauxCredit,
      dureeMois,
      ptzMontant = 0,
      ptzDureeMois = dureeMois,
      assuranceTaux = 0,
      assuranceBase = "initial",
      assuranceQuotite = 1,
    } = opts;

    const iP = tauxCredit / 12;
    const mP = mensualite(montantPrincipal, tauxCredit, dureeMois);
    const mZ = ptzMontant > 0 ? mensualite(ptzMontant, 0, ptzDureeMois) : 0;
    const capitalAssureInitial = (montantPrincipal + ptzMontant) * assuranceQuotite;

    let restP = montantPrincipal;
    let restZ = ptzMontant;
    const nbMois = Math.max(dureeMois, ptzDureeMois);
    const rows = [];

    for (let k = 1; k <= nbMois; k++) {
      // Prêt principal
      let intP = 0,
        capP = 0;
      if (k <= dureeMois && restP > 0.005) {
        intP = restP * iP;
        capP = k === dureeMois ? restP : mP - intP;
        capP = Math.min(capP, restP);
        restP = Math.max(0, restP - capP);
      }
      // PTZ (taux 0)
      let capZ = 0;
      if (k <= ptzDureeMois && restZ > 0.005) {
        capZ = k === ptzDureeMois ? restZ : mZ;
        capZ = Math.min(capZ, restZ);
        restZ = Math.max(0, restZ - capZ);
      }

      const restant = restP + restZ;
      // Assurance
      let assur;
      if (assuranceBase === "restant") {
        // Base = capital restant dû du mois précédent (avant amortissement de ce mois)
        const baseAssur = (restant + capP + capZ) * assuranceQuotite;
        assur = (baseAssur * assuranceTaux) / 12;
      } else {
        assur = (capitalAssureInitial * assuranceTaux) / 12;
      }

      rows.push({
        mois: k,
        interet: round2(intP),
        capitalPrincipal: round2(capP),
        capitalPTZ: round2(capZ),
        assurance: round2(assur),
        mensualite: round2(intP + capP + capZ + assur),
        restant: round2(restant),
      });
    }
    return rows;
  }

  /**
   * Agrège un échéancier détaillé par année civile de prêt (12 mois).
   */
  function agregerParAnnee(rows) {
    const annees = [];
    for (let i = 0; i < rows.length; i += 12) {
      const tranche = rows.slice(i, i + 12);
      const somme = (f) => tranche.reduce((s, r) => s + r[f], 0);
      annees.push({
        annee: Math.floor(i / 12) + 1,
        interet: round2(somme("interet")),
        capitalPrincipal: round2(somme("capitalPrincipal")),
        capitalPTZ: round2(somme("capitalPTZ")),
        assurance: round2(somme("assurance")),
        mensualite: round2(somme("mensualite")),
        restant: tranche[tranche.length - 1].restant,
      });
    }
    return annees;
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

    // --- Frais à régler COMPTANT par l'emprunteur (NON financés par le crédit) ---
    // Ils n'entrent donc PAS dans la mensualité, mais restent comptés dans le coût
    // total du crédit et dans le TAEG (obligation légale).
    const fraisComptant = fraisDossier + garantie;

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
      fraisComptant: round2(fraisComptant),
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
    tauxAssuranceEmprunteur,
    tauxAssuranceEffectif,
    echeancier,
    echeancierDetaille,
    agregerParAnnee,
    coutInterets,
    emolumentsNotaire,
    fraisNotaire,
    fraisGarantie,
    calculPTZ,
    taeg,
    simulerBanque,
  };
})(typeof window !== "undefined" ? window : globalThis);
