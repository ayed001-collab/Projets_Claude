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
  // URL du flux : valeur mémorisée si présente, sinon le flux par défaut du dépôt.
  let feedUrl = (() => {
    try {
      const saved = localStorage.getItem(FEED_KEY);
      if (saved !== null) return saved; // "" = l'utilisateur a volontairement vidé le champ
    } catch (e) {
      /* ignore */
    }
    return Rates.DEFAULT_FEED_URL;
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
        "Aucun flux configuré (champ vidé). Ouvrez « ✎ Modifier » pour renseigner une URL de flux JSON — ou saisissez les taux à la main, ils seront mémorisés."
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
      statut(
        statusEl,
        "err",
        "Échec de la mise à jour : " +
          e.message +
          " — Sur le lien hébergé (Artifact), les requêtes externes sont bloquées : utilisez « ✎ Modifier » pour saisir les taux (mémorisés)."
      );
    }
  }

  /* ---------------- Lecture des entrées ---------------- */
  function lireAssures() {
    const assures = [
      {
        age: +$("age1").value || 35,
        fumeur: $("fum1").checked,
        profession: $("prof1").value,
        quotite: (+$("quot1").value || 0) / 100,
      },
    ];
    if ($("coEmp").checked) {
      assures.push({
        age: +$("age2").value || 35,
        fumeur: $("fum2").checked,
        profession: $("prof2").value,
        quotite: (+$("quot2").value || 0) / 100,
      });
    }
    return assures;
  }

  function lireEntrees() {
    const assures = lireAssures();
    const { tauxEffectif, detail } = Finance.tauxAssuranceEffectif(assures);
    const prix = +$("prix").value || 0;
    const autofinPct = (+$("autofinPct").value || 0) / 100;
    return {
      prix,
      typeBien: $("typeBien").value,
      dmto: $("dmto").value ? +$("dmto").value : null,
      zone: $("zone").value,
      autofinPct,
      // Autofinancement (apport) calculé automatiquement à partir du taux.
      apport: prix * autofinPct,
      dureeMois: +$("duree").value,
      garantie: $("garantie").value,
      // Le taux effectif agrège les quotités : on l'applique au capital avec quotité = 1.
      assuranceTaux: tauxEffectif,
      assuranceBase: $("assuranceBase").value,
      assuranceQuotite: 1,
      assures,
      assuranceDetail: detail,
      ptzActif: $("ptzActif").checked,
      ptzRevenus: +$("ptzRevenus").value || 0,
      ptzPersonnes: +$("ptzPersonnes").value || 1,
    };
  }

  /**
   * Plan de financement (modèle du cas pratique) :
   *   Coût total de l'opération = Prix + Frais de notaire
   *   Prêt bancaire = Coût total − Apport (autofinancement) − PTZ
   * L'apport (cash à apporter) couvre d'abord les frais de notaire, le reste
   * finance une partie du prix. Il n'entre pas en plus des frais : c'est LE cash
   * apporté à l'opération.
   * @returns {Object} détail du financement
   */
  function calculerFinancement(e, notaireTotal, ptzMontant) {
    const coutOperation = e.prix + notaireTotal;
    const besoin = Math.max(0, coutOperation - e.apport);
    const montantPrincipal = Math.max(0, besoin - ptzMontant);

    // Répartition de l'apport : couvre d'abord le notaire, le reste finance le prix.
    const apportVersNotaire = Math.min(e.apport, notaireTotal);
    const apportVersPrix = Math.max(0, e.apport - notaireTotal);

    // L'apport = autofinancement = taux × prix (calculé automatiquement).
    const autofinPct = e.autofinPct || 0;
    const couvreNotaire = e.apport >= notaireTotal - 0.5;
    const manqueNotaire = Math.max(0, notaireTotal - e.apport);

    return {
      coutOperation,
      montantPrincipal,
      notaireTotal,
      apportVersNotaire,
      apportVersPrix,
      autofinPct,
      couvreNotaire,
      manqueNotaire,
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
    const coutOperation = e.prix + notaire.total; // information

    // 2) PTZ (finance une partie du prix, plafonné au prix)
    let ptz = { eligible: false, montant: 0 };
    if (e.ptzActif) {
      ptz = Finance.calculPTZ(
        {
          zone: e.zone,
          personnes: e.ptzPersonnes,
          revenus: e.ptzRevenus,
          coutOperation: e.prix,
          typeBien: e.typeBien,
        },
        Data.PTZ
      );
    }
    // 3) Financement (modèle du cas pratique) :
    //    Prêt = (Prix + Notaire) − Apport (autofinancement) − PTZ.
    const besoin = Math.max(0, coutOperation - e.apport);
    const ptzMontant = ptz.eligible ? Math.min(ptz.montant, besoin) : 0;
    const fin = calculerFinancement(e, notaire.total, ptzMontant);
    const montantPrincipal = fin.montantPrincipal;
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
    afficherRecap(e, notaire, ptzMontant, fin);
    afficherComptant(e, fin, resultats, montantPrincipal);
    afficherAssuranceCalc(e, montantPrincipal + ptzMontant);
    afficherPTZ(e, ptz, ptzMontant);
    afficherComparatif(resultats, coutOperation);
    afficherLeviers(e, resultats);
    remplirSelecteurAmort(resultats);
    afficherAmortissement();
  }

  /* ---------------- Affichages ---------------- */
  function afficherRecap(e, notaire, ptzMontant, fin) {
    const rows = [];
    // --- Coût de l'opération = prix + frais de notaire ---
    rows.push(["Prix du bien", euro(e.prix), ""]);
    rows.push([
      `Frais de notaire (${e.typeBien}) — ${pct(notaire.tauxEffectif)}`,
      euro(notaire.total),
      "accent",
    ]);
    for (const [k, v] of Object.entries(notaire.detail)) {
      rows.push([`&nbsp;&nbsp;• ${k}`, euro(v), "sub"]);
    }
    rows.push(["Coût total de l'opération", euro(fin.coutOperation), "total"]);
    // --- Plan de financement : prêt = coût total − apport − PTZ ---
    rows.push(["– Autofinancement (apport)", "− " + euro(e.apport), ""]);
    if (ptzMontant > 0) rows.push(["– Prêt à Taux Zéro (PTZ)", "− " + euro(ptzMontant), "accent"]);
    rows.push(["Prêt bancaire (montant emprunté)", euro(fin.montantPrincipal), "total"]);

    $("recapAcquisition").innerHTML = rows
      .map(([lbl, val, cls]) => {
        const lblCls = cls === "sub" ? "lbl sub" : "lbl" + (cls === "total" ? " total" : "");
        const valCls = "val" + (cls === "total" ? " total" : "") + (cls === "accent" ? " accent" : "");
        return `<div class="${lblCls}">${lbl}</div><div class="${valCls}">${val}</div>`;
      })
      .join("");
  }

  /**
   * Frais à régler comptant par l'emprunteur (hors prêt) : frais de garantie
   * (indépendants de la banque) + frais de dossier (variables selon la banque).
   * Ces montants ne sont PAS financés → ils n'entrent pas dans la mensualité.
   */
  function afficherComptant(e, fin, resultats, montantPrincipal) {
    // Montant d'autofinancement calculé automatiquement, affiché sous le champ de taux.
    $("autofinMontant").innerHTML =
      `<div class="line"><span>Autofinancement (${(fin.autofinPct * 100).toLocaleString("fr-FR")} % × prix)</span><span class="big">${euro(e.apport)}</span></div>`;

    const rows = [];
    // Cash à apporter = autofinancement = taux × prix (calculé automatiquement).
    rows.push([
      `Cash à apporter — autofinancement (${(fin.autofinPct * 100).toLocaleString("fr-FR")} % du prix)`,
      euro(e.apport),
      "total",
    ]);
    // Répartition de l'apport (comme le cas pratique)
    rows.push(["&nbsp;&nbsp;• dont frais de notaire", euro(fin.apportVersNotaire), "sub"]);
    rows.push([
      "&nbsp;&nbsp;• dont participation au prix du bien",
      euro(fin.apportVersPrix),
      "sub",
    ]);
    if (!fin.couvreNotaire) {
      rows.push([
        "⚠ Autofinancement insuffisant pour couvrir le notaire, manque",
        euro(fin.manqueNotaire),
        "bad",
      ]);
    }

    $("comptantRecap").innerHTML = rows
      .map(([lbl, val, cls]) => {
        const lblCls = cls === "sub" ? "lbl sub" : "lbl" + (cls === "total" ? " total" : "");
        const valCls =
          "val" +
          (cls === "total" ? " total" : "") +
          (cls === "accent" ? " accent" : "") +
          (cls === "good" ? " good" : "") +
          (cls === "bad" ? " bad" : "");
        return `<div class="${lblCls}">${lbl}</div><div class="${valCls}">${val}</div>`;
      })
      .join("");
  }

  /**
   * Détaille l'assurance emprunteur : taux et prime mensuelle par assuré + total.
   * Base capital initial pour l'affichage (prime constante) ; la base « restant dû »
   * donne une prime dégressive (visible dans le tableau d'amortissement).
   */
  function afficherAssuranceCalc(e, capitalAssure) {
    const noms = e.assures.length > 1 ? ["Emprunteur 1", "Co-emprunteur"] : ["Emprunteur 1"];
    let totalMensuel = 0;
    const lignes = e.assuranceDetail
      .map((d, i) => {
        const mensuel = (capitalAssure * d.taux * d.quotite) / 12;
        totalMensuel += mensuel;
        return `<div class="line"><span>${noms[i]} — ${pct(d.taux)} × ${(d.quotite * 100).toFixed(0)} %</span><span>${euro2(mensuel)}/mois</span></div>`;
      })
      .join("");
    const totalQuotite = e.assuranceDetail.reduce((s, d) => s + d.quotite, 0);
    $("assuranceCalc").innerHTML =
      `<div class="line"><span>Taux effectif (Σ taux × quotité)</span><span class="big">${pct(e.assuranceTaux)}</span></div>` +
      lignes +
      `<div class="line"><span><strong>Prime totale (1re mensualité)</strong></span><span class="big">${euro2(totalMensuel)}/mois</span></div>` +
      `<div class="line" style="margin-top:6px;color:var(--muted)"><span>Couverture totale</span><span>${(totalQuotite * 100).toFixed(0)} %</span></div>`;
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
    // Affichage/masquage du bloc co-emprunteur
    $("coEmp").addEventListener("change", () => {
      $("borrower2").hidden = !$("coEmp").checked;
      simuler();
    });
    // Recalcul dynamique sur les champs principaux
    [
      "prix", "typeBien", "dmto", "zone", "autofinPct", "duree", "garantie",
      "assuranceBase", "age1", "prof1", "fum1", "quot1",
      "age2", "prof2", "fum2", "quot2",
      "ptzActif", "ptzRevenus", "ptzPersonnes",
    ].forEach((id) => $(id).addEventListener("change", simuler));
    simuler(); // simulation initiale
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
