/*
 * app.js — Interface & orchestration de la simulation.
 * Lit les saisies, appelle le moteur Finance, affiche les résultats.
 */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const euro = (x) =>
    (Math.round(x) || 0).toLocaleString("fr-FR") + " €";
  const euro2 = (x) =>
    (x || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  const pct = (x) => (x * 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 }) + " %";

  // Banques actives (copie éditable des banques par défaut)
  let banques = Data.BANQUES_DEFAUT.map((c) => ({ ...c, grilleTaux: { ...c.grilleTaux } }));

  // État courant des taux (date de mise à jour, origine) + URL du flux configuré
  let etatTaux = Rates.etatInitial();
  const FEED_KEY = "simu-credit-feed-url-v1";
  let feedUrl = (() => {
    try {
      return localStorage.getItem(FEED_KEY) || "";
    } catch (e) {
      return "";
    }
  })();

  // Contexte de la dernière simulation (pour le tableau d'amortissement)
  let dernierContexte = null;

  /**
   * Applique un état de taux (issu de Rates) sur les banques actives.
   * Les taux du flux sont en % ; le moteur attend des fractions.
   */
  function appliquerTaux(etat) {
    for (const b of banques) {
      const grille = etat.banques[b.id];
      if (!grille) continue;
      for (const d of [180, 240, 300]) {
        if (Number.isFinite(grille[d])) b.grilleTaux[d] = grille[d] / 100;
      }
    }
    etatTaux = etat;
  }

  /** Affiche la ligne « Taux mis à jour le … » + lien vers les sources. */
  function afficherMetaTaux() {
    const d = new Date(etatTaux.dateMaj + "T00:00:00");
    const dateFr = isNaN(d) ? etatTaux.dateMaj : d.toLocaleDateString("fr-FR");
    $("ratesMeta").innerHTML = `Taux au <strong>${dateFr}</strong> · ${etatTaux.origine}`;
  }

  /** Affiche un message de statut (ok / err / info) dans une zone donnée. */
  function statut(elId, type, message) {
    const el = $(elId);
    if (!message) {
      el.hidden = true;
      return;
    }
    el.className = "rates-status " + type;
    el.textContent = message;
    el.hidden = false;
  }

  /** Récupère les taux depuis le flux configuré et les applique. */
  async function mettreAJourTaux(statusEl) {
    if (!feedUrl) {
      statut(
        statusEl,
        "info",
        "Aucune URL de flux configurée. Ouvrez « ✎ Modifier » pour renseigner un flux JSON, ou saisissez les taux à la main."
      );
      return;
    }
    statut(statusEl, "info", "Chargement des taux depuis le flux…");
    try {
      const etat = await Rates.chargerDepuisUrl(feedUrl);
      appliquerTaux(etat);
      Rates.sauvegarder(etat);
      afficherMetaTaux();
      simuler();
      const d = new Date(etat.dateMaj + "T00:00:00");
      statut(
        statusEl,
        "ok",
        `Taux mis à jour (${etat.origine}, ${isNaN(d) ? etat.dateMaj : d.toLocaleDateString("fr-FR")}).`
      );
    } catch (e) {
      statut(statusEl, "err", "Échec de la mise à jour : " + e.message);
    }
  }

  /* ---------------- Lecture des entrées ---------------- */
  function lireEntrees() {
    return {
      prix: +$("prix").value || 0,
      typeBien: $("typeBien").value,
      dmto: $("dmto").value ? +$("dmto").value : null,
      zone: $("zone").value,
      apport: +$("apport").value || 0,
      dureeMois: +$("duree").value,
      garantie: $("garantie").value,
      assuranceTaux: (+$("assuranceTaux").value || 0) / 100,
      assuranceBase: $("assuranceBase").value,
      assuranceQuotite: (+$("assuranceQuotite").value || 100) / 100,
      ptzActif: $("ptzActif").checked,
      ptzRevenus: +$("ptzRevenus").value || 0,
      ptzPersonnes: +$("ptzPersonnes").value || 1,
    };
  }

  /* ---------------- Calcul principal ---------------- */
  function simuler() {
    const e = lireEntrees();
    if (e.prix <= 0) {
      alert("Veuillez saisir un prix de bien valide.");
      return;
    }

    // 1) Frais de notaire
    const notaire = Finance.fraisNotaire(e.prix, e.typeBien, e.dmto);

    // 2) Coût total de l'opération (hors frais de crédit) et besoin de financement
    const coutOperation = e.prix + notaire.total;
    // Montant à emprunter = coût opération - apport
    let besoinFinancement = Math.max(0, coutOperation - e.apport);

    // 3) PTZ
    let ptz = { eligible: false, montant: 0 };
    if (e.ptzActif) {
      ptz = Finance.calculPTZ(
        {
          zone: e.zone,
          personnes: e.ptzPersonnes,
          revenus: e.ptzRevenus,
          coutOperation: e.prix, // le PTZ finance le coût du logement (hors notaire)
          typeBien: e.typeBien,
        },
        Data.PTZ
      );
    }
    const ptzMontant = ptz.eligible ? Math.min(ptz.montant, besoinFinancement) : 0;

    // 4) Répartition PTZ / prêt principal
    const montantPrincipal = Math.max(0, besoinFinancement - ptzMontant);
    // Durée PTZ : on aligne sur la durée du prêt principal (approximation prudente).
    const ptzDureeMois = e.dureeMois;

    // 5) Simulation par banque
    const resultats = banques
      .map((cfg) => {
        const banque = Data.makeBanque(cfg);
        return Finance.simulerBanque({
          banque,
          dureeMois: e.dureeMois,
          montantPrincipal,
          ptzMontant,
          ptzDureeMois,
          assuranceTaux: e.assuranceTaux,
          assuranceBase: e.assuranceBase,
          assuranceQuotite: e.assuranceQuotite,
          typeGarantie: e.garantie,
        });
      })
      .sort((a, b) => a.coutTotalCredit - b.coutTotalCredit);

    // Mémorise le contexte pour le tableau d'amortissement
    dernierContexte = {
      e,
      resultats,
      montantPrincipal,
      ptzMontant,
      ptzDureeMois,
    };

    // 6) Affichage
    afficherRecap(e, notaire, coutOperation, besoinFinancement, ptzMontant, montantPrincipal);
    afficherPTZ(e, ptz, ptzMontant);
    afficherComparatif(resultats, coutOperation);
    afficherLeviers(e, resultats);
    remplirSelecteurAmort(resultats);
    afficherAmortissement();
  }

  /* ---------------- Affichages ---------------- */
  function afficherRecap(e, notaire, coutOperation, besoin, ptzMontant, principal) {
    const rows = [];
    rows.push(["Prix du bien", euro(e.prix), ""]);
    rows.push([
      `Frais de notaire (${e.typeBien}) — ${pct(notaire.tauxEffectif)}`,
      euro(notaire.total),
      "accent",
    ]);
    for (const [k, v] of Object.entries(notaire.detail)) {
      rows.push([`&nbsp;&nbsp;• ${k}`, euro(v), "sub"]);
    }
    rows.push(["Coût total de l'opération", euro(coutOperation), "total"]);
    rows.push(["– Apport personnel", "− " + euro(e.apport), ""]);
    if (ptzMontant > 0) rows.push(["– Prêt à Taux Zéro (PTZ)", "− " + euro(ptzMontant), "accent"]);
    rows.push(["Montant emprunté (prêt principal)", euro(principal), "total"]);

    $("recapAcquisition").innerHTML = rows
      .map(([lbl, val, cls]) => {
        const lblCls = cls === "sub" ? "lbl sub" : "lbl" + (cls === "total" ? " total" : "");
        const valCls = "val" + (cls === "total" ? " total" : "") + (cls === "accent" ? " accent" : "");
        return `<div class="${lblCls}">${lbl}</div><div class="${valCls}">${val}</div>`;
      })
      .join("");
  }

  function afficherPTZ(e, ptz, ptzMontant) {
    const el = $("ptzResult");
    if (!e.ptzActif) {
      el.innerHTML = `<p class="hint">Simulation PTZ désactivée.</p>`;
      return;
    }
    if (!ptz.eligible || ptzMontant <= 0) {
      el.innerHTML = `
        <span class="ptz-badge no">Non éligible</span>
        <p>${ptz.motif || "Aucun PTZ applicable pour ce profil."}</p>`;
      return;
    }
    el.innerHTML = `
      <span class="ptz-badge ok">Éligible — Tranche ${ptz.tranche}</span>
      <div class="recap-grid">
        <div class="lbl">Montant du PTZ</div><div class="val accent">${euro(ptzMontant)}</div>
        <div class="lbl">Quotité appliquée</div><div class="val">${pct(ptz.quotite)}</div>
        <div class="lbl">Revenu retenu (max RFR / coût÷9)</div><div class="val">${euro(ptz.revenuRetenu)}</div>
        <div class="lbl">Plafond de coût (zone ${e.zone}, ${e.ptzPersonnes} pers.)</div><div class="val">${euro(ptz.plafondCout)}</div>
        <div class="lbl">Différé de remboursement indicatif</div><div class="val">${ptz.differeAnnees} ans</div>
      </div>
      <p class="hint" style="margin-top:12px">${ptz.motif}</p>`;
  }

  function afficherComparatif(resultats, coutOperation) {
    const tbody = $("comparatif").querySelector("tbody");
    const banquesById = Object.fromEntries(banques.map((b) => [b.nom, b]));
    tbody.innerHTML = resultats
      .map((r, idx) => {
        const couleur = (banquesById[r.banqueNom] || {}).couleur || "#888";
        return `
        <tr class="${idx === 0 ? "best" : ""}">
          <td><span class="bank-dot" style="background:${couleur}"></span>${r.banqueNom}</td>
          <td class="num">${pct(r.tauxCredit)}</td>
          <td class="num">${euro2(r.mensualiteTotale)}</td>
          <td class="num">${euro2(r.mensAssurance)}</td>
          <td class="num">${euro(r.fraisDossier)}</td>
          <td class="num">${euro(r.garantie)}</td>
          <td class="num">${euro(r.coutTotalCredit)}</td>
          <td class="num">${pct(r.taegApprox)}</td>
        </tr>`;
      })
      .join("");
  }

  function afficherLeviers(e, resultats) {
    const meilleur = resultats[0];
    const pire = resultats[resultats.length - 1];
    const ecart = pire.coutTotalCredit - meilleur.coutTotalCredit;
    const leviers = [
      `<strong>Mettre les banques en concurrence.</strong> Sur votre projet, l'écart de coût total du crédit entre la meilleure (${meilleur.banqueNom}) et la moins favorable (${pire.banqueNom}) atteint <strong>${euro(ecart)}</strong>. Un courtier peut négocier ces écarts.`,
      `<strong>Déléguer l'assurance emprunteur.</strong> La loi Lemoine permet d'en changer à tout moment. Passer d'un contrat groupe (≈0,34 %) à une délégation (≈0,10–0,15 % pour un profil jeune et non-fumeur) peut économiser plusieurs milliers d'euros sur la durée.`,
      `<strong>Augmenter l'apport personnel.</strong> Un apport plus élevé réduit le capital emprunté, améliore le taux proposé et diminue les frais de garantie (calculés sur le montant du prêt).`,
      `<strong>Optimiser la durée.</strong> Raccourcir la durée réduit fortement le coût total des intérêts et de l'assurance, au prix d'une mensualité plus élevée (à arbitrer avec votre taux d'endettement, plafonné à ≈35 %).`,
      `<strong>Mobiliser les prêts aidés.</strong> PTZ (taux 0 %), Prêt Action Logement (≈1 % pour les salariés du privé), prêts régionaux/locaux, Prêt Accession Sociale (PAS) et prêt conventionné : ils viennent en complément et abaissent le taux moyen pondéré.`,
      `<strong>Négocier les frais annexes.</strong> Frais de dossier (souvent remisables voire offerts), choix caution vs hypothèque (la caution est en partie restituable), et absence d'indemnités de remboursement anticipé.`,
      `<strong>Lisser les prêts (prêts à paliers).</strong> Combiner PTZ et prêt principal avec un lissage permet de maintenir une mensualité globale stable et d'optimiser le taux d'endettement.`,
    ];
    $("leviers").innerHTML = leviers.map((l) => `<li>${l}</li>`).join("");
  }

  /* ---------------- Tableau d'amortissement ---------------- */
  function remplirSelecteurAmort(resultats) {
    const sel = $("amortBanque");
    const prev = sel.value;
    sel.innerHTML = resultats
      .map((r) => `<option value="${r.banqueNom}">${r.banqueNom} — ${pct(r.tauxCredit)}</option>`)
      .join("");
    // Conserve la sélection si possible, sinon prend la meilleure (1re)
    if (prev && resultats.some((r) => r.banqueNom === prev)) sel.value = prev;
  }

  function construireEcheancier() {
    if (!dernierContexte) return null;
    const { e, resultats, montantPrincipal, ptzMontant, ptzDureeMois } = dernierContexte;
    const nomChoisi = $("amortBanque").value || (resultats[0] && resultats[0].banqueNom);
    const res = resultats.find((r) => r.banqueNom === nomChoisi) || resultats[0];
    if (!res) return null;
    const rows = Finance.echeancierDetaille({
      montantPrincipal,
      tauxCredit: res.tauxCredit,
      dureeMois: e.dureeMois,
      ptzMontant,
      ptzDureeMois,
      assuranceTaux: e.assuranceTaux,
      assuranceBase: e.assuranceBase,
      assuranceQuotite: e.assuranceQuotite,
    });
    return { res, rows, hasPTZ: ptzMontant > 0 };
  }

  function afficherAmortissement() {
    const data = construireEcheancier();
    const table = $("amortTable");
    if (!data) {
      table.querySelector("thead").innerHTML = "";
      table.querySelector("tbody").innerHTML = "";
      table.querySelector("tfoot").innerHTML = "";
      $("amortMeta").textContent = "";
      return;
    }
    const { res, rows, hasPTZ } = data;
    const vue = $("amortVue").value;
    const affichees = vue === "annuel" ? Finance.agregerParAnnee(rows) : rows;
    const cle = vue === "annuel" ? "annee" : "mois";
    const libelle = vue === "annuel" ? "Année" : "Mois";

    $("amortMeta").innerHTML = `Prêt principal de <strong>${euro(dernierContexte.montantPrincipal)}</strong> au taux de <strong>${pct(res.tauxCredit)}</strong>${hasPTZ ? ` + PTZ de <strong>${euro(dernierContexte.ptzMontant)}</strong> à 0 %` : ""} — assurance ${dernierContexte.e.assuranceBase === "restant" ? "sur capital restant dû" : "sur capital initial"}.`;

    const colVerse = vue === "annuel" ? "Total versé" : "Mensualité";
    const cols = [
      libelle,
      "Intérêts",
      "Capital (principal)",
      ...(hasPTZ ? ["Capital (PTZ)"] : []),
      "Assurance",
      colVerse,
      "Capital restant dû",
    ];
    table.querySelector("thead").innerHTML =
      "<tr>" + cols.map((c) => `<th>${c}</th>`).join("") + "</tr>";

    table.querySelector("tbody").innerHTML = affichees
      .map((r) => {
        const cells = [
          r[cle],
          euro2(r.interet),
          euro2(r.capitalPrincipal),
          ...(hasPTZ ? [euro2(r.capitalPTZ)] : []),
          euro2(r.assurance),
          euro2(r.mensualite),
          euro(r.restant),
        ];
        return "<tr>" + cells.map((c, i) => `<td class="${i === 0 ? "" : "num"}">${c}</td>`).join("") + "</tr>";
      })
      .join("");

    // Total (sur l'échéancier mensuel complet, indépendamment de la vue)
    const somme = (f) => rows.reduce((s, r) => s + r[f], 0);
    const totCells = [
      "Total",
      euro(somme("interet")),
      euro(somme("capitalPrincipal")),
      ...(hasPTZ ? [euro(somme("capitalPTZ"))] : []),
      euro(somme("assurance")),
      euro(somme("mensualite")),
      "—",
    ];
    table.querySelector("tfoot").innerHTML =
      "<tr>" + totCells.map((c, i) => `<td class="${i === 0 ? "" : "num"}">${c}</td>`).join("") + "</tr>";
  }

  function exporterCsv() {
    const data = construireEcheancier();
    if (!data) return;
    const { res, rows, hasPTZ } = data;
    const entete = [
      "Mois",
      "Interets",
      "Capital_principal",
      ...(hasPTZ ? ["Capital_PTZ"] : []),
      "Assurance",
      "Mensualite",
      "Capital_restant_du",
    ];
    const lignes = rows.map((r) =>
      [
        r.mois,
        r.interet,
        r.capitalPrincipal,
        ...(hasPTZ ? [r.capitalPTZ] : []),
        r.assurance,
        r.mensualite,
        r.restant,
      ].join(";")
    );
    const csv = [entete.join(";"), ...lignes].join("\r\n");
    // BOM pour un affichage correct des accents dans Excel
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `amortissement_${res.banqueNom.replace(/[^a-z0-9]/gi, "_")}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /* ---------------- Modale d'édition des taux ---------------- */
  function ouvrirModale() {
    const tbody = $("ratesTable").querySelector("tbody");
    tbody.innerHTML = banques
      .map((b, i) => {
        const dossier =
          b.dossierType === "pourcentage"
            ? `${(b.dossierValeur * 100).toFixed(2)} % (max ${b.dossierMax} €)`
            : `${b.dossierValeur} € (forfait)`;
        const src = Rates.SOURCES[b.id];
        const lienSource = src
          ? `<a href="${src.url}" target="_blank" rel="noopener noreferrer">page officielle ↗</a>`
          : "—";
        return `
        <tr>
          <td>${b.nom}</td>
          <td><input type="number" step="0.01" data-i="${i}" data-d="180" value="${(b.grilleTaux[180] * 100).toFixed(2)}"></td>
          <td><input type="number" step="0.01" data-i="${i}" data-d="240" value="${(b.grilleTaux[240] * 100).toFixed(2)}"></td>
          <td><input type="number" step="0.01" data-i="${i}" data-d="300" value="${(b.grilleTaux[300] * 100).toFixed(2)}"></td>
          <td>${dossier}</td>
          <td>${lienSource}</td>
        </tr>`;
      })
      .join("");
    $("feedUrl").value = feedUrl;
    statut("modalStatus", "info", "");
    $("ratesModal").hidden = false;
  }

  function sauverModale() {
    $("ratesTable")
      .querySelectorAll("input[data-i]")
      .forEach((inp) => {
        const i = +inp.dataset.i;
        const d = +inp.dataset.d;
        banques[i].grilleTaux[d] = (+inp.value || 0) / 100;
      });
    // Mémorise les taux saisis manuellement (origine « saisie manuelle »).
    const etat = {
      dateMaj: new Date().toISOString().slice(0, 10),
      origine: "Saisie manuelle",
      banques: {},
    };
    for (const b of banques) {
      etat.banques[b.id] = {
        180: b.grilleTaux[180] * 100,
        240: b.grilleTaux[240] * 100,
        300: b.grilleTaux[300] * 100,
      };
    }
    etatTaux = etat;
    Rates.sauvegarder(etat);
    afficherMetaTaux();
    $("ratesModal").hidden = true;
    simuler();
  }

  function memoriserFeedUrl() {
    feedUrl = $("feedUrl").value.trim();
    try {
      if (feedUrl) localStorage.setItem(FEED_KEY, feedUrl);
      else localStorage.removeItem(FEED_KEY);
    } catch (e) {
      /* ignore */
    }
  }

  async function actualiserDepuisModale() {
    memoriserFeedUrl();
    await mettreAJourTaux("modalStatus");
    if (feedUrl) ouvrirModale(); // rafraîchit les champs si le chargement a réussi
    $("ratesModal").hidden = false;
  }

  function reinitialiserTaux() {
    Rates.reinitialiser();
    const etat = JSON.parse(JSON.stringify(Rates.BAREME_EMBARQUE));
    appliquerTaux(etat);
    Rates.sauvegarder(etat);
    afficherMetaTaux();
    ouvrirModale();
    statut("modalStatus", "ok", "Barème embarqué rétabli.");
    simuler();
  }

  /* ---------------- Thème ---------------- */
  function toggleTheme() {
    const root = document.documentElement;
    const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
  }

  /* ---------------- Init ---------------- */
  function init() {
    // Applique l'état de taux initial (local ou barème embarqué) aux banques.
    appliquerTaux(etatTaux);
    afficherMetaTaux();

    $("simuler").addEventListener("click", simuler);
    $("editRates").addEventListener("click", ouvrirModale);
    $("editRates2").addEventListener("click", ouvrirModale);
    $("ratesSave").addEventListener("click", sauverModale);
    $("ratesClose").addEventListener("click", () => ($("ratesModal").hidden = true));
    $("updateRates").addEventListener("click", () => mettreAJourTaux("ratesStatus"));
    $("fetchRates").addEventListener("click", actualiserDepuisModale);
    $("resetRates").addEventListener("click", reinitialiserTaux);
    $("theme-toggle").addEventListener("click", toggleTheme);
    $("amortBanque").addEventListener("change", afficherAmortissement);
    $("amortVue").addEventListener("change", afficherAmortissement);
    $("exportCsv").addEventListener("click", exporterCsv);
    $("exportPdf").addEventListener("click", () => window.print());
    // Fermeture de la modale (clic hors du cadre, touche Échap)
    $("ratesModal").addEventListener("click", (ev) => {
      if (ev.target === $("ratesModal")) $("ratesModal").hidden = true;
    });
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") $("ratesModal").hidden = true;
    });
    // Recalcul dynamique sur les champs principaux
    ["prix", "typeBien", "dmto", "zone", "apport", "duree", "garantie", "assuranceTaux", "assuranceBase", "assuranceQuotite", "ptzActif", "ptzRevenus", "ptzPersonnes"].forEach(
      (id) => $(id).addEventListener("change", simuler)
    );
    simuler(); // simulation initiale
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
