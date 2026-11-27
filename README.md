# Fond de placard — Inventaire du foyer

L’inventaire des placards, du frigo, du congélateur (et de tout ce qu’on veut), pensé pour le téléphone et partagé avec son foyer. On scanne en rentrant des courses, on scanne en consommant, et ce qui vient à manquer part tout seul dans la liste de courses [ListMe](https://maximemons.github.io/ListMe/).

## Placards

- Les produits sont rangés par **rangement** (Placard, Frigo, Congélateur, Fruits et légumes, Cave, Salle de bain, Entretien…), dans l’ordre choisi dans l’onglet Rangements, puis par ordre alphabétique.
- Une barre de recherche filtre en direct par nom, marque, nom de liste ou code-barres (sans tenir compte des accents ni des majuscules).
- Les pastilles du haut filtrent un rangement, ou **À racheter** : les produits dont l’alerte de stock est déclenchée.
- Chaque ligne a un compteur **− / +** pour corriger le stock d’un geste. Un appui sur le produit ouvre sa fiche.
- Les produits sous leur seuil d’alerte portent l’étiquette **À racheter** (ou **Sur la liste** une fois envoyés vers ListMe, **Acheté** une fois rachetés).
- Les produits dont une date limite tombe dans les 3 jours portent une étiquette rouge (**DLC dans 2 j**, **Périmé**…) ; sinon la prochaine DLC est rappelée sous le nom. La pastille **Bientôt périmés** les regroupe.

## Scanner

Le bouton code-barres, au centre de la barre du bas, ouvre la caméra. Trois modes, mémorisés sur l’appareil :

- **Choisir** : le produit scanné s’affiche avec son stock ; on choisit la quantité puis **Ajouter** ou **Sortir** ;
- **+ Entrée** : chaque scan ajoute une unité (idéal pour ranger les courses) ;
- **− Sortie** : chaque scan retire une unité (produit consommé, bouteille vide).

Chaque mouvement peut être **annulé** juste après. Un code peut aussi être saisi à la main sous la caméra. La lampe s’allume si le téléphone le permet.

### Code-barres inconnu

- Le code est cherché dans les bases ouvertes **Open Food Facts**, **Open Beauty Facts**, **Open Pet Food Facts** et **Open Products Facts** : nom, marque, format et photo sont repris, et un rangement est proposé (surgelé → Congélateur, vin → Cave, produit laitier → Frigo…).
- **Ajouter ce produit** ouvre la fiche pré-remplie, à corriger si besoin.
- **C’est un produit déjà dans le placard** associe ce nouveau code à un produit existant : un même produit peut avoir **plusieurs codes-barres** (autre marque, autre format, nouvel emballage).
- Seul le code-barres est envoyé à ces bases, jamais une donnée du compte.

Le scanner utilise le détecteur intégré au navigateur quand il existe (Chrome sur Android) et sinon la bibliothèque **ZXing** embarquée (iPhone, Firefox). Les codes UPC-A (12 chiffres) sont ramenés à leur équivalent EAN-13 pour qu’un produit soit reconnu de la même façon sur tous les téléphones.

## Produits sans code-barres

**Ajouter un produit** (bouton en bas à droite) propose :

- une recherche dans ses produits et dans un petit catalogue de fruits, légumes et produits frais (pommes, pommes de terre, persil, œufs, pain…), avec leur émoji et leur unité habituelle ;
- **Créer « … »** pour n’importe quel autre produit.

## Fiche produit

- **Nom**, **marque**, **format** (ex. `500 g`) et **rangement** (ou « Nouveau rangement… » directement depuis la liste).
- **Photo** : un appui sur la vignette permet de prendre ou choisir une photo (compressée sur le téléphone avant l’envoi), ou de retirer la photo. Sans photo personnelle, la photo d’Open Food Facts est utilisée, sinon l’émoji.
- **Compté en** : pièce, kilo, gramme, litre, centilitre, botte, paquet, boîte, bouteille, pot, sachet, rouleau. Le pas du compteur suit l’unité (± 1 pièce, ± 0,25 kg, ± 100 g, ± 0,5 l…). Une quantité précise peut aussi être tapée.
- **Émoji** : remplace l’icône du rangement dans la liste.
- **Alerte de stock** :
  - **Alerter à partir de** : 0 pour être prévenu quand il n’y en a plus, 2 ou 3 pour s’y prendre plus tôt ;
  - **Quantité à racheter** : proposée sur la liste de courses ;
  - **Nom sur la liste de courses** : facultatif, un nom simple (« Lait » plutôt que « Lait demi-écrémé UHT Lactel 1 l ») est mieux rangé par rayon dans ListMe.
- **Codes-barres** : ajouter (scan ou saisie) ou retirer. Si un code appartient déjà à un autre produit, l’appli propose de le déplacer.
- **Supprimer** le produit (pour tout le foyer).

## Dates limites (DLC)

Chaque produit peut porter une **liste de dates limites**, chacune avec sa quantité (ex. 4 yaourts au 2 déc., 4 au 9 déc.).

- **Fiche produit** › **Dates limites (DLC)** : ajouter, modifier ou retirer une date. Le total daté ne peut pas dépasser le stock.
- **Acheté** (onglet Courses) : les DLC des articles achetés se saisissent au moment de valider la quantité.
- **Scanner** : après un ajout au stock, le bouton **DLC** enregistre la date des unités qui viennent d’entrer.
- Quand le stock baisse (−, scan de sortie, grand inventaire), les unités dont la date est la plus proche partent en premier.
- **3 jours avant** une date (réglable avec `DLC_WARN_DAYS` dans `js/dlc.js`), une notification apparaît dans la cloche, et elle y reste tant que le lot n’est pas retiré.

## Notifications (cloche)

La cloche, en haut à droite à côté du profil, rassemble :

- les **dates limites proches ou dépassées** (« Yaourt nature : bientôt périmé, Périme dans 2 jours ») : un appui ouvre la fiche, **Retirer** propose « Consommé ou jeté » (le lot sort du stock) ou « Enlever seulement la date » ;
- les **produits à racheter** (« Racheter Lait ») : un appui ouvre les Courses.

La pastille rouge compte les notifications pas encore vues sur cet appareil. Tout est calculé en direct à partir du placard : rien de plus n’est stocké côté serveur.

## Courses (vers ListMe)

L’onglet **Courses** liste les produits dont l’alerte est activée et dont le stock est **inférieur ou égal au seuil**. La pastille sur l’onglet compte ceux qui ne sont pas encore partis sur la liste.

- Chaque produit peut être décoché, et sa quantité à acheter ajustée.
- **Envoyer vers ListMe** ouvre ListMe dans un nouvel onglet avec les produits, comme le fait Aux fourneaux (`?list=ID&produit=quantité`). Les quantités au poids ou au volume sont transmises avec leur unité (`2,5 kg`).
- **Liste ListMe du foyer** : coller le lien du bouton « Partager » de ListMe relie une liste ; tous les envois du foyer la remplissent. Sans lien, chaque envoi crée une nouvelle liste « Fond de placard ».
- Un produit envoyé est marqué **Envoyé le …** et n’est plus coché par défaut. Dès que son stock repasse au-dessus du seuil (retour des courses), la marque disparaît d’elle-même.
- **Copier la liste** copie le texte (`- Lait : 6`) pour un autre usage.
- **Acheté** : au retour des courses, un appui sur ce bouton demande la quantité réellement achetée (et, si besoin, les dates limites). Le produit est ajouté au stock et **quitte la liste**, même si le stock reste sous le seuil ; il y reviendra dès que ce stock aura de nouveau baissé.

L’adresse de ListMe utilisée par défaut se règle dans `js/listme.js` (`LISTME_URL`).

## Grand inventaire

L’onglet **Inventaire** recale les quantités quand l’appli et la réalité ont divergé.

1. Choisir les rangements à compter (tous par défaut).
2. Les produits défilent un par un, rangement par rangement : la quantité de l’appli est rappelée, on règle la quantité réelle puis **Valider et continuer**. **Il n’y en a plus** met à 0, **Passer** laisse le produit non compté. La loupe et le code-barres de l’en-tête permettent de sauter à un produit (par recherche ou en le scannant).
3. **Revoir et terminer** affiche les écarts (`3 → 5`, `+2`) et les produits non comptés, avec l’option **Les mettre à 0**.
4. **Enregistrer l’inventaire** : les quantités comptées **écrasent** celles de l’appli, pour tout le foyer. La date et l’auteur du dernier inventaire s’affichent dans Mon compte.

Le comptage en cours est gardé sur le téléphone : on peut fermer l’appli et reprendre plus tard, ou l’abandonner sans rien changer.

## Rangements

L’onglet **Rangements** donne une vue d’ensemble : nombre de produits et de produits à racheter par rangement. Un appui ouvre les placards filtrés sur ce rangement.

- **Ajouter un rangement** (en bas de la liste) : nom et icône (ou un émoji libre).
- Le **crayon** renomme, change l’icône ou supprime (les produits sont déplacés vers le rangement choisi).
- Les **flèches** changent l’ordre d’affichage dans les placards et dans le grand inventaire.

## Mon compte et mon foyer

Le bouton rond en haut à droite affiche la **photo Google** de la personne connectée, ou ses **initiales** sur une pastille de couleur pour un compte e-mail. Un point jaune signale une invitation reçue. Il ouvre **Mon compte** :

- nom, adresse e-mail et mode de connexion (Google ou e-mail) ; **Modifier mon prénom** pour un compte e-mail ;
- **Se déconnecter** (le placard reste enregistré et revient à la reconnexion) ;
- rappel de confirmation de l’adresse e-mail si besoin (renvoyer l’e-mail, « C’est fait ») ;
- **Invitations reçues**, avec le bouton **Rejoindre** ;
- **Mon foyer** : nom (le crayon le renomme), nombre de produits, date du dernier grand inventaire ;
- **Membres** : chacun voit et modifie le même placard, en direct. **Inviter quelqu’un du foyer** par son adresse e-mail : à sa prochaine connexion avec cette adresse (Google, ou e-mail confirmé), l’invitation lui est proposée. En rejoignant, on peut **copier ses produits** dans le placard commun (les rangements de même nom sont fusionnés). Le créateur peut **retirer** un membre ;
- raccourci vers les **Rangements** ;
- **Liste ListMe du foyer** : relier, changer ou délier la liste ;
- **Quitter le foyer** (quand il y a d’autres membres : on repart avec un placard vide).

## Compte

- Connexion par **e-mail et mot de passe** (création de compte, mot de passe oublié) ou avec **Google**.
- Un e-mail de confirmation est envoyé à la création du compte : il faut l’avoir validé pour **rejoindre** un foyer qui vous invite (on ne peut pas se faire passer pour quelqu’un d’autre en créant un compte à son adresse).
- À la première connexion, un foyer « Chez Prénom » est créé avec les rangements par défaut (sauf si une invitation attend : l’appli propose alors de la rejoindre).

## Hors ligne

- Le cache local de Firestore garde tout le placard sur l’appareil : consultation et modifications fonctionnent sans réseau (cave, sous-sol, magasin) et partent dès le retour du réseau. Un bandeau signale le mode hors ligne.
- Le service worker met en cache l’appli, ZXing, les modules Firebase, les polices et les icônes : une fois ouverte une première fois, elle démarre sans réseau.
- Les **+/−** utilisent un incrément côté serveur : deux personnes qui sortent un produit en même temps retirent bien 2.

---

## Mise en route Firebase

Projet : `fond-de-placard-5eb12`.

1. **Authentication** › Méthodes de connexion : activer **Adresse e-mail/Mot de passe** et **Google**.
2. **Authentication** › Paramètres › **Domaines autorisés** : ajouter le domaine GitHub Pages, par ex. `maximemons.github.io`.
3. **Authentication** › Modèles : passer les e-mails (confirmation d’adresse, réinitialisation du mot de passe) en **français** si besoin.
4. **Firestore Database** : créer la base (mode production, région `eur3` ou `europe-west` conseillée).
5. Publier les règles de `firestore.rules` : console Firestore › **Règles** (coller puis Publier), ou en ligne de commande :

```
npm install -g firebase-tools
firebase login
firebase deploy --only firestore:rules
```

Aucun index composite n’est nécessaire. Firebase Storage n’est pas utilisé : les photos sont compressées (≤ 250 Ko) et stockées dans Firestore, ce qui permet de rester sur l’offre gratuite.

## Héberger sur GitHub Pages

1. Pousser le contenu du dossier à la racine d’un dépôt (ex. `Fond-de-placard`).
2. Dépôt › **Settings** › **Pages** : Source « Deploy from a branch », branche `main`, dossier `/ (root)`.
3. L’appli est servie sur `https://<compte>.github.io/Fond-de-placard/` (HTTPS obligatoire pour la caméra et le service worker).

Tous les chemins sont relatifs : l’appli fonctionne dans un sous-dossier, sans compilation. Le fichier `.nojekyll` évite le traitement Jekyll.

À chaque mise en ligne, incrémenter `VERSION` dans `sw.js` pour que les téléphones récupèrent la nouvelle version.

En local : `python3 -m http.server` dans le dossier, puis `http://localhost:8000` (la caméra fonctionne sur `localhost`).

### Connexion Google sur iPhone

La connexion Google s’ouvre dans une fenêtre surgissante (popup). Si l’appli est installée sur l’écran d’accueil d’un iPhone et que la fenêtre ne revient pas, utiliser la connexion par e-mail, ou se connecter une fois depuis Safari.

## Sécurité et données personnelles

- La clé `apiKey` de `js/firebase-config.js` est prévue pour être publique : elle identifie le projet, ce sont les **règles Firestore** qui protègent les données. Elles doivent impérativement être publiées (étape 5) avant d’ouvrir l’appli à d’autres personnes.
- Les règles garantissent que :
  - chaque compte ne lit que son propre document `users/{uid}` ;
  - un foyer, ses produits et ses photos ne sont lisibles et modifiables que par ses **membres** ;
  - une personne invitée (adresse e-mail **confirmée**) peut seulement lire le foyer qui l’invite et s’y ajouter elle-même ;
  - seul le créateur peut retirer un autre membre ; un membre peut partir ; personne ne peut ajouter un tiers sans invitation ;
  - les photos sont limitées en taille et en format ; tout le reste de la base est fermé.
- Données personnelles conservées : nom affiché et adresse e-mail des membres (visibles des seuls membres du foyer), adresses e-mail invitées (visibles des membres du foyer qui invite et de la personne invitée). Rien d’autre sur les personnes : pas de localisation, pas de suivi.
- Données envoyées à des tiers : uniquement les **codes-barres** scannés, vers les bases Open Food Facts, pour trouver le produit.
- Recommandé : activer **App Check** (reCAPTCHA Enterprise) dans la console Firebase pour limiter les appels aux seuls domaines de l’appli, et définir une alerte de budget.
- Ne mettez pas d’informations confidentielles dans les noms de produits, de rangements ou de foyer.

## Structure

```
index.html
css/style.css
js/firebase-config.js   configuration et initialisation Firebase
js/app.js               connexion, navigation, placards, fiche produit, scanner, courses, foyer
js/inventory.js         grand inventaire
js/store.js             données Firestore : foyer, produits, photos, rangements, invitations
js/scanner.js           caméra et lecture des codes-barres (BarcodeDetector ou ZXing)
js/lookup.js            recherche d’un code dans Open Food Facts et bases sœurs
js/listme.js            envoi des courses vers ListMe
js/dlc.js               dates limites : calculs, lots, alertes à 3 jours
js/notifications.js     cloche de l’en-tête : DLC proches et produits à racheter
js/catalog.js           rangements par défaut, unités, fruits et légumes courants
js/products-ui.js       vignettes et libellés des produits
js/ui.js                dialogues, panneaux, toasts, compression des photos
js/vendor/zxing.min.js  ZXing (@zxing/library 0.21.3, licence Apache 2.0)
sw.js                   service worker (hors ligne)
manifest.webmanifest    installation sur l’écran d’accueil (raccourcis Scanner et Courses)
firestore.rules         règles d’accès à publier
firebase.json           déploiement des règles avec firebase-tools
```

## Données Firestore

```
users/{uid}                        householdId, email, name
households/{hid}                   name, ownerUid, memberUids[], members{uid: {email, name}},
                                   invitedEmails[], categories[{id, name, icon}], listmeLink,
                                   lastInventoryAt, lastInventoryBy
households/{hid}/products/{id}     name, brand, format, emoji, unit, categoryId, qty, barcodes[],
                                   alert, threshold, restockQty, listName, imageUrl, source,
                                   hasPhoto, photoAt, sentAt, boughtLevel, lots[{id, date, qty}],
                                   createdAt, updatedAt, updatedBy
households/{hid}/images/{id}       data (photo compressée, data URL JPEG)
```
