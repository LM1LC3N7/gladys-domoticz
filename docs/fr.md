# Passerelle Domoticz

Cette intégration relie Gladys à **votre Domoticz** et propose chaque appareil
Domoticz dans l'onglet **Découverte** de Gladys : lumières, interrupteurs,
volets, serrures, thermostats, capteurs, compteurs. Une fois un appareil
ajouté, ses états suivent Domoticz en quelques secondes, et Gladys le pilote
**à travers Domoticz**, qui continue de tourner avec son matériel (Z-Wave,
Zigbee, RFXCOM, P1, plugins…). Passez à Gladys à votre rythme, pièce par pièce,
ou utilisez les deux côte à côte. Non officiel, sans lien avec Domoticz.

> **Version de développement (0.1).** Testée avec l'image Docker officielle de
> Domoticz (Domoticz 2026.4) et des appareils virtuels de chaque sorte, pas
> encore sur beaucoup de vraies installations. Vos retours sont les bienvenus
> sur le dépôt GitHub.

## Ce que vous obtenez

| Appareils Domoticz                                                                                      | Dans Gladys                                                              |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Interrupteur On/Off, variateur (une lumière, ou un interrupteur si vous lui avez donné une autre icône) | allumage, luminosité                                                     |
| Interrupteur couleur (RGB, RGBW, RGBWW, blanc CW/WW)                                                    | une lumière : allumage, luminosité, couleur, température de couleur      |
| Volets, volets + stop, stores vénitiens, volets pourcentage (+ stop)                                    | un volet : ouvrir, fermer, stop, position                                |
| Sélecteur                                                                                               | une liste de ses niveaux                                                 |
| Serrure, serrure inversée                                                                               | une serrure                                                              |
| Sirène X10                                                                                              | une sirène                                                               |
| Bouton poussoir (Push On / Push Off), sonnette                                                          | un bouton (chaque appui est un événement pour vos scènes)                |
| Contact, contact de porte, détecteur de mouvement, détecteur de fumée, capteur crépuscule               | capteurs d'ouverture, de mouvement, de fumée                             |
| Consigne (thermostat)                                                                                   | une consigne de thermostat                                               |
| Temp, Temp + Humidité (+ Baro), Humidité, Baromètre, Pluie, Vent, UV, Lux                               | capteurs de température, humidité, pression, pluie, vent, UV, luminosité |
| Usage, kWh, compteur P1 (avec l'énergie injectée), courant, tension                                     | puissance, index d'énergie, injection réseau, courant, tension           |
| Compteurs de gaz, d'eau et d'énergie (incrémental, géré, RFXMeter)                                      | un volume (m³) ou un index d'énergie                                     |
| Qualité de l'air, niveau sonore, distance, pression, pourcentage, capteur personnalisé                  | le capteur de la bonne catégorie, ou une valeur avec son unité           |
| Texte, alerte, centrale d'alarme                                                                        | un texte                                                                 |
| Niveau de batterie des appareils sur pile                                                               | le niveau de batterie                                                    |

Chaque appareil Domoticz **utilisé** donne **un appareil Gladys**, nommé
d'après l'appareil et son emplacement (« Lampe (Salon) ») ; son idx, son type
et son matériel sont gardés dans ses paramètres. Les appareils non marqués
comme utilisés, les scènes et groupes (pour l'instant) et les lecteurs
multimédias sont écartés.

Les fonctions secondaires d'un appareil sont nommées dans la langue de
l'interface Domoticz (« Station météo – humidité »), et les températures et
vitesses de vent suivent ses unités (°C ou °F, m/s ou km/h ; mph et nœuds sont
convertis en km/h).

## Prérequis

- Domoticz 2023.2 ou plus récent (les jetons d'accès demandent 2026.2 ou plus).
- La machine Gladys joint Domoticz sur le réseau local (port 8080 en http, 443
  en https par défaut).

## Installation

1. Dans Domoticz, créez un **jeton d'accès** : **Configuration → Plus
   d'options → Access Tokens**, avec les droits « Utilisateur » (pour piloter
   les appareils) et sans expiration. Domoticz ne l'affiche qu'une fois :
   copiez-le.
   - Domoticz plus ancien : utilisez plutôt un **utilisateur**
     (**Configuration → Utilisateurs**), avec les droits « Utilisateur » ou
     plus et sans double authentification.
2. Dans Gladys, ouvrez l'intégration, **Configuration** :
   - **Adresse de Domoticz** : l'adresse avec laquelle vous ouvrez Domoticz,
     vue depuis la machine Gladys, port compris : `http://192.168.1.20:8080`
     ou `https://domoticz.lan`. Pas `localhost` : l'intégration tourne dans son
     propre conteneur.
   - **Jeton d'accès** : collez-le. Ou le **nom d'utilisateur** et le **mot de
     passe**.
3. Cliquez sur **Tester la connexion** : la version de Domoticz, la façon dont
   Gladys s'est identifiée, le nombre d'appareils et de pièces, et le nombre
   d'appareils proposés s'affichent.
4. Ouvrez l'onglet **Découverte** et ajoutez les appareils voulus. Leurs
   valeurs sont envoyées dès l'ajout.

Laissez les trois champs d'identification vides seulement si l'adresse de la
machine Gladys fait partie des **réseaux de confiance** de Domoticz
(**Configuration → Paramètres → Sécurité**).

## Options

- **Vérifier le certificat TLS (https)** : activé par défaut. À désactiver pour
  le certificat auto-signé d'une installation Domoticz par défaut.
- **Intervalle entre deux lectures des changements Domoticz** : 3 secondes par
  défaut (1 à 60). Gladys demande à Domoticz quels appareils ont changé depuis
  la dernière lecture.
- **Intervalle minimum entre deux mesures d'un capteur** : 10 secondes par
  défaut (0 à 300). Un compteur qui remonte toutes les quelques secondes est
  envoyé à Gladys à ce rythme. Interrupteurs, lumières, boutons, détecteurs de
  mouvement et d'ouverture ne sont jamais retardés.

## Bon à savoir

- **Domoticz reste aux commandes du matériel** : Gladys envoie ses ordres à
  Domoticz, qui pilote les modules Z-Wave, Zigbee, RFXCOM… Gardez Domoticz en
  marche.
- **Un nouvel appareil** apparaît dans Découverte en quelques secondes, à sa
  première mise à jour. **Un appareil renommé** (Domoticz ne compte pas un
  renommage comme une mise à jour) apparaît sous 10 minutes, tout de suite avec
  le bouton **Scanner** de l'onglet Découverte.
- **Boutons poussoirs et sonnettes** : chaque appui arrive à vos scènes, même
  deux appuis du même bouton à la suite (Domoticz date les mises à jour à la
  seconde : deux appuis dans la même seconde comptent pour un).
- **Badge de transport** : un appareil passe « injoignable » quand Domoticz
  l'est, ou quand son matériel est désactivé dans Domoticz ; un capteur que
  Domoticz signale en dépassement de délai (rouge dans Domoticz) prend un point
  orange.
- **Les appareils protégés par un code** dans Domoticz ne se pilotent pas
  depuis Gladys : retirez la protection pour le faire.
- **Contacts de porte** : Domoticz dit Ouvert / Fermé, Gladys 0 pour ouvert et
  1 pour fermé ; l'intégration convertit.

## Dépannage

| Message d'état                                     | Que faire                                                                                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Domoticz a refusé le jeton d'accès                 | Créez-en un nouveau (Configuration → Plus d'options → Access Tokens) et collez-le.                                                   |
| Domoticz a refusé l'utilisateur ou le mot de passe | Vérifiez-les dans Configuration → Utilisateurs. Un utilisateur en double authentification ne convient pas : prenez un jeton d'accès. |
| Domoticz demande à Gladys de s'identifier          | Renseignez un jeton d'accès ou un utilisateur, ou ajoutez la machine Gladys aux réseaux de confiance.                                |
| Domoticz a refusé l'accès                          | L'utilisateur ou le jeton doit avoir au moins les droits « Utilisateur ».                                                            |
| Domoticz est injoignable : connection refused      | Vérifiez l'adresse et le port (8080 par défaut), vus depuis la machine Gladys, pas `localhost`. Domoticz tourne-t-il ?               |
| certificate refused                                | Un certificat auto-signé : désactivez « Vérifier le certificat TLS », ou utilisez `http://`.                                         |

Les logs de l'intégration (Gladys, page de l'intégration) donnent le détail.

## Vie privée

Tout reste sur votre réseau local : l'intégration ne parle qu'à votre
Domoticz. Le jeton d'accès et le mot de passe sont stockés comme des secrets
par Gladys et ne sont jamais écrits dans les logs.
