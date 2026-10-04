# Macros Roll20

Chaque fichier `*.macro.txt` se colle tel quel dans une macro Roll20 (Collection de macros, nouvelle macro). Les
scripts API dont elles dépendent sont à installer dans la partie (Game Settings > API Scripts).

| Macro | Ce qu'elle fait | Dépend de |
| --- | --- | --- |
| `Blindroll` | Chuchote au token sélectionné un menu de 13 boutons de compétences (Évaluation, Bluff, Diplomatie, Sabotage, Déguisement, Intimidation, Perception, Psychologie, Art de la magie, Discrétion, Survie, Représentation, Linguistique), chacun avec le bonus du token. Un clic lance `!broll <compétence> 1d20+bonus`, un jet à l'aveugle. | `!broll` (script absent de ce dépôt) |
| `Climat` | Lance `!climat`, le point d'entrée du générateur de météo. | `scripts/Climat.js` |
| `Config_init` | Réinitialise le suivi d'initiative de groupe : supprime l'ancien groupe, crée un groupe avec `init` et le bonus d'initiative comme départage. La partie « (Optional) » règle 1 dé, 2 décimales max, jet individuel, tri décroissant et remplacement du jet. | GroupInitiative |
| `Invisible` | Passe le token sélectionné sur sa 2ᵉ face (`currentside|2`) et cache son nom et ses 3 barres aux joueurs. | TokenMod |
| `Perception-passive` | `!group-check --Perception` : jet de Perception pour tous les tokens sélectionnés. | GroupCheck |
| `Vision` | Menu de vision pour le token sélectionné : Activée, Désactivée, Vision en aveugle (10), Vision dans le noir 18, 27 ou 36 m, Vision dans le noir désactivée. Chuchote « changed vision » au MJ. | TokenMod |
| `lumiere` | Menu de source de lumière : Off, Proximité, Bougie, Lampe, Torche, Lanterne à capote, Lanterne sourde (cône de 90°), Lumière, Lumières dansantes, Lumière du jour. Fixe aussi l'opacité de la lumière faible à 30. | TokenMod |
| `restartPfc` | `!pfc --i` : initialise PFCompanion. | PFCompanion |
| `gabarit` | Lance le gabarit de zone d'effet : choix de la forme et de la taille, création du Viseur. | `scripts/gabarit.js` |

Notes :
- `Config_init` contient une ligne « (Optional) » qui sépare la partie obligatoire de la partie facultative : à
  coller en deux macros, ou à retirer.
- `viseur.png` est l'image du Viseur utilisée par `gabarit.js` (voir le README principal).
