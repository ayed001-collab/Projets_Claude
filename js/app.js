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

    // 6) Affichage
    afficherRecap(e, notaire, coutOperation, besoinFinancement, ptzMontant, montantPrincipal);
    afficherPTZ(e, ptz, ptzMontant);
    afficherComparatif(resultats, coutOperation);
    afficherLeviers(e, resultats);
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

  /* ---------------- Modale d'édition des taux ---------------- */
  function ouvrirModale() {
    const tbody = $("ratesTable").querySelector("tbody");
    tbody.innerHTML = banques
      .map((b, i) => {
        const dossier =
          b.dossierType === "pourcentage"
            ? `${(b.dossierValeur * 100).toFixed(2)} % (max ${b.dossierMax} €)`
            : `${b.dossierValeur} € (forfait)`;
        return `
        <tr>
          <td>${b.nom}</td>
          <td><input type="number" step="0.01" data-i="${i}" data-d="180" value="${(b.grilleTaux[180] * 100).toFixed(2)}"></td>
          <td><input type="number" step="0.01" data-i="${i}" data-d="240" value="${(b.grilleTaux[240] * 100).toFixed(2)}"></td>
          <td><input type="number" step="0.01" data-i="${i}" data-d="300" value="${(b.grilleTaux[300] * 100).toFixed(2)}"></td>
          <td>${dossier}</td>
        </tr>`;
      })
      .join("");
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
    $("ratesModal").hidden = true;
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
    $("simuler").addEventListener("click", simuler);
    $("editRates").addEventListener("click", ouvrirModale);
    $("ratesSave").addEventListener("click", sauverModale);
    $("ratesClose").addEventListener("click", () => ($("ratesModal").hidden = true));
    $("theme-toggle").addEventListener("click", toggleTheme);
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
