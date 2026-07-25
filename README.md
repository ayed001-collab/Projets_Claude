# 🏠 Simulateur de Crédit Immobilier — Comparateur multi-banques

Plateforme web de simulation de crédit immobilier destinée au marché français.
Elle chiffre le **coût complet d'une acquisition** et compare les **mensualités** entre
les banques les plus compétitives, en intégrant frais de notaire, frais de dossier,
assurance emprunteur, garantie et **Prêt à Taux Zéro (PTZ)**.

> ⚠️ **Estimations pédagogiques.** Les taux, frais et barèmes sont *indicatifs* et évoluent.
> Seule une étude personnalisée d'un établissement prêteur ou d'un courtier, avec un TAEG
> contractuel, a valeur d'engagement.

---

## Lancer la plateforme

Aucune installation, aucun build. Ouvrez simplement `index.html` dans un navigateur.

```bash
# ou servez le dossier localement :
python3 -m http.server 8000    # puis http://localhost:8000
```

---

## Fonctionnalités

| Besoin exprimé | Implémentation |
|---|---|
| Taux des 5 banques les plus compétitives (dont Société Générale) | Grille éditable : SG, Crédit Agricole, BNP Paribas, Caisse d'Épargne, Crédit Mutuel/CIC — taux par durée (15/20/25 ans), avec **date de mise à jour**, **liens vers les pages officielles** et bouton **« ⟳ Mettre à jour »** (flux JSON configurable) |
| Saisie du montant du bien | Champ prix + apport personnel |
| Frais de notaire (neuf vs ancien) | Barème réglementé des émoluments + DMTO différenciés (≈7,4 % ancien / ≈2,3 % neuf), avec option de majoration départementale 2025 |
| Coût du dossier selon la banque | Frais de dossier paramétrables par banque (forfait ou %) |
| Frais d'assurance crédit | Taux, base (capital initial *ou* restant dû) et quotité paramétrables |
| Calcul des échéances mensuelles | Mensualité assurance comprise, par banque, avec frais intégrés |
| PTZ / prêt à taux zéro | Éligibilité + montant selon zone, revenus, composition du foyer (barèmes 2025) |
| Options de réduction du coût | Section « leviers » + comparateur d'écart de coût total |
| Tableau d'amortissement | Échéancier détaillé par banque (vue mensuelle ou annuelle), prêt principal + PTZ + assurance, avec **export CSV** et **impression / PDF** |

Le simulateur calcule aussi un **TAEG approché** par recherche du taux annulant la valeur
actuelle nette des flux (mensualités + frais de dossier + garantie).

---

## Architecture

```
index.html        Structure & formulaire
css/styles.css    Mise en forme (thème clair/sombre)
js/finance.js     Moteur de calcul — fonctions pures, testables (aucune dépendance UI)
js/data.js        Données de référence : banques, barèmes PTZ, tranches notaire
js/rates.js       Fournisseur de taux : flux JSON, mise à jour, persistance locale
js/app.js         Orchestration : lecture des saisies → calcul → affichage
data/taux.sample.json  Exemple de flux de taux (format attendu par « Mettre à jour »)
```

Le moteur (`finance.js`) est isolé de l'interface pour être testé indépendamment
(voir la commande de test Node ci-dessous).

```bash
node -e 'global.window=globalThis; require("./js/finance.js"); require("./js/data.js");
  console.log(Finance.fraisNotaire(300000,"ancien").total);'
```

---

## Mise à jour automatique des taux

> ⚠️ **Un navigateur ne peut pas lire directement les sites des banques** (politique CORS ;
> et les banques ne publient pas de taux personnalisés exploitables). Le scraping côté client
> est donc impossible — et le lien Artifact hébergé bloque en plus toute requête externe.

**Par défaut, le bouton fonctionne sans configuration** : il charge `data/taux.json` du dépôt,
servi par GitHub raw (CORS activé). Mettez à jour ce fichier et committez → le bouton recharge
les nouvelles valeurs. Vous pouvez aussi pointer vers votre propre flux.

> **Sur le lien Artifact hébergé**, les requêtes externes sont **bloquées** par la politique de
> sécurité (aucune capacité d'accès réseau externe n'existe pour ces pages). Le bouton y affiche
> alors un message explicite : utilisez **« ✎ Modifier »** pour saisir les taux (mémorisés
> localement). La mise à jour automatique fonctionne dans la version du dépôt (local, GitHub
> Pages, hébergement classique).

Le bouton **« ⟳ Mettre à jour »** consomme un **flux JSON configurable** (`data/taux.sample.json`
donne le format), que vous alimentez selon votre contexte :

- **Saisie manuelle** dans la fenêtre « ✎ Modifier » (mémorisée en local) ;
- **API d'un courtier / agrégateur** exposant les barèmes avec en-têtes CORS ;
- **Script serveur** (exécuté hors navigateur — Node, Python…) qui agrège les barèmes publiés
  et publie un JSON conforme sur un hôte que vous contrôlez.

L'URL du flux et les taux sont mémorisés (localStorage). Chaque banque affiche un lien vers sa
**page officielle de barème** pour vérification. Format du flux :

```json
{
  "dateMaj": "2026-07-20",
  "origine": "Nom de la source",
  "banques": { "sg": {"180": 3.15, "240": 3.35, "300": 3.55}, "ca": { } }
}
```

Les identifiants de banque (`sg`, `ca`, `bnp`, `ce`, `cmut`) correspondent à ceux de `js/data.js` ;
les taux sont en pourcentage.

## Méthodologie de calcul

- **Mensualité** : annuités constantes `M = C·i / (1 − (1+i)^−n)`, `i` = taux mensuel.
- **Frais de notaire** : émoluments proportionnels (barème dégressif réglementé + TVA 20 %)
  + droits de mutation (DMTO ≈ 5,81 % ancien / 0,715 % neuf) + contribution de sécurité
  immobilière (0,10 %) + débours forfaitaires.
- **Garantie** : caution (≈1,2 %, partiellement restituable) ou hypothèque/IPPD (≈1,5 %).
- **Assurance** : sur capital initial (constante) ou capital restant dû (dégressive).
- **PTZ** : `montant = min(coût ; plafond zone) × quotité de tranche`. Tranche déterminée
  par `max(RFR N-2 ; coût/9)` comparé aux plafonds de revenu (× coefficient familial).
- **TAEG** : bissection sur le taux annulant la VAN des flux réels.

Hypothèses simplificatrices assumées : différé PTZ modélisé de façon prudente (PTZ amorti sur
la durée du prêt principal) ; débours notariés forfaitisés ; barèmes bancaires indicatifs.

---

## 📋 Revue critique du cahier des charges (prompt)

Le prompt initial est **clair et déjà très complet sur le cœur métier** (frais de notaire
neuf/ancien, frais de dossier par banque, assurance, mensualités, PTZ, leviers d'optimisation).
Il est **suffisant pour livrer une V1 crédible**, ce que fait cette plateforme.

Pour hisser la plateforme au niveau d'un outil professionnel de courtage, **plusieurs points
gagneraient à être précisés**. Ils ont été anticipés par des hypothèses par défaut (documentées),
mais mériteraient une décision explicite :

### 1. Éléments manquants ou implicites à trancher
- **Frais de garantie** (caution vs hypothèque) : non cités mais indispensables au coût réel → *ajoutés par défaut*.
- **TAEG et taux d'usure** : le vrai comparateur légal est le TAEG, pas le taux nominal → *TAEG approché ajouté* ; reste à contrôler le respect du **taux d'usure** trimestriel.
- **Taux d'endettement / reste à vivre** : la faisabilité (≤ 35 % HCSF) devrait conditionner la simulation → *à ajouter* (nécessite les revenus et charges du foyer).
- **Frais annexes** : frais d'agence, frais de courtage, frais de tenue de compte, mobilier déductible de l'assiette notariale.
- **Assurance** : distinguer emprunteurs (co-emprunteur), âge, tabac, profession → impacte fortement le taux ; la loi Lemoine (délégation) devrait être un scénario.

### 2. Précisions de barèmes à confirmer
- **Actualité des taux** : la plateforme ne peut pas garantir des taux « en vigueur » en temps réel sans flux de données (API courtier / observatoire CSA-Crédit Logement). → *Taux éditables* en attendant.
- **DMTO départementaux** : varient de 5,09 % à 6,31 % (majoration 2025) selon le département → *option ajoutée*.
- **PTZ** : les barèmes (plafonds, quotités, différés) changent quasi annuellement → à re-vérifier contre le décret en vigueur.

### 3. Points de cadrage produit non abordés
- **Objectif** : achat résidence principale, investissement locatif (Pinel/LMNP, fiscalité différente) ou secondaire ? Le PTZ ne concerne que la RP des primo-accédants.
- **Prêts complémentaires** : Prêt Action Logement, PAS, prêt conventionné, éco-PTZ, prêts régionaux — à modéliser pour un « plan de financement » complet et un **lissage de prêts**.
- **Sorties attendues** : tableau d'amortissement exportable (CSV / PDF) ✅ *implémenté* ; enregistrement/comparaison de scénarios, envoi par e-mail : à venir.
- **Conformité** : mentions légales, RGPD si données personnelles stockées, statut IOBSP si conseil.

### Conclusion
Le prompt est **complet pour définir une V1 fonctionnelle et pertinente** — livrée ici. Pour une
version « production » de courtage, les compléments prioritaires sont : **contrôle du taux
d'endettement HCSF**, **respect du taux d'usure**, **plan de financement multi-prêts (lissage)**
et **alimentation des taux par une source de données à jour**.

---

## Limites connues

- Taux, frais bancaires et barèmes PTZ sont des **valeurs indicatives éditables**, non un flux temps réel.
- Le TAEG et les frais de notaire sont des **estimations** ; le TAEG contractuel prévaut.
- Le contrôle du taux d'endettement (HCSF ≤ 35 %) et du taux d'usure n'est pas encore implémenté.
