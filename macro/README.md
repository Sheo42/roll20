# Macros Roll20

Chaque fichier `*.macro.txt` se colle tel quel dans une macro Roll20 (Collection de macros, nouvelle macro). Les
scripts API dont elles dépendent sont à installer dans la partie (Game Settings > API Scripts).

| Macro | Ce qu'elle fait | Dépend de |
| --- | --- | --- |
| `Blindroll` | Jet secret de compétence pour le token sélectionné : une liste déroulante propose 13 compétences (Évaluation, Bluff, Diplomatie, Sabotage, Déguisement, Intimidation, Perception, Psychologie, Art de la magie, Discrétion, Survie, Représentation, Linguistique) puis lance un jet secret natif de Roll20 (`/sr 1d20+bonus[Compétence]`) : seul le MJ voit le résultat, le joueur reçoit juste une confirmation. Pas de menu de boutons : l'éditeur de macros transforme `&#13;` en vrai saut de ligne, ce qui casse un `/sr` lancé depuis un bouton. | Rien (jets secrets natifs, remplace le script BlindRoll.js et `!broll`) |
| `BuffTracker` | Lance `!buff`, le menu du suivi des buffs et durées de sort. Macro visible par tous les joueurs. | `scripts/bufftracker.js` |
| `Vol` | Lance `!alt`, le menu du combat en vol : coût d'un vol, altitude, rejoindre une cible, chute, liste des altitudes. Macro visible par tous les joueurs. | `scripts/altitude.js` |
| `Climat` | Lance `!climat`, le point d'entrée du générateur de météo. | `scripts/Climat.js` |
| `Config_init` | Réinitialise le suivi d'initiative de groupe : supprime l'ancien groupe, crée un groupe avec `init` et le bonus d'initiative comme départage. La partie « (Optional) » règle 1 dé, 2 décimales max, jet individuel, tri décroissant et remplacement du jet. | GroupInitiative |
| `Invisible` | `!invis` : bascule le token sélectionné entre invisible (2ᵉ face transparente, nom, barres et auras cachés aux autres joueurs) et visible (tout est remis tel quel, taille comprise). Remplace aussi l'ancienne macro « Visible ». | `scripts/invis.js` |
| `Perception-passive` | `!group-check --Perception` : jet de Perception pour tous les tokens sélectionnés. | GroupCheck |
| `Vision` | Menu de vision pour le token sélectionné : Activée, Désactivée, Vision en aveugle (10), Vision dans le noir 18, 27 ou 36 m, Vision dans le noir désactivée. Chuchote « changed vision » au MJ. | TokenMod |
| `lumiere` | Menu de source de lumière (portées PF1 en mètres, lumière vive + anneau de lumière faible) : Éteindre, Proximité, Bougie, Lampe, Torche, Torche éternelle, Lanterne à capote, Lanterne sourde (cône de 90°), Bâton éclairant, Lumière, Flamme éternelle, Lumières dansantes, Lumière du jour. Teinte orangée pour les flammes. Agit sur tous les tokens sélectionnés et fixe l'opacité de la lumière faible à 30. | TokenMod |
| `restartPfc` | `!pfc --i` : initialise PFCompanion. | PFCompanion |
| `gabarit` | Lance le gabarit de zone d'effet : choix de la forme et de la taille, création du Viseur. | `scripts/gabarit.js` |

Notes :
- `Config_init` contient une ligne « (Optional) » qui sépare la partie obligatoire de la partie facultative : à
  coller en deux macros, ou à retirer.
- `viseur.png` est l'image du Viseur utilisée par `gabarit.js` (voir le README principal).
