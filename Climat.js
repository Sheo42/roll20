var region = "";
var mois = "";

on("chat:message", function(msg) {
var cmdRegion = "!region";
var cmdMois = "!RollClimat";
var msgTxt = msg.content;
var msgWho = msg.who;
var args;
var skill;
var roll;
var temperature;

    //log("message text is " + msgTxt);
if ((msg.type === "api") && (msgTxt.indexOf(cmdRegion) !== -1))
{
    args = msgTxt.replace(cmdRegion,'').trim().toLowerCase();
    //log("args text is " + args);
    region = args;
    sendChat(msgWho, "/w gm &{template:pf_generic} {{name=Mois}} {{ [Abadius](!RollClimat Abadius)   [Calistril](!RollClimat Calistril)   [Pharast](!RollClimat Pharast)  [Gozran](!RollClimat Gozran)  [Desnus](!RollClimat Desnus)   [Sarénith](!RollClimat Sarenith) [Erastus](!RollClimat Erastus)  [Arodus](!RollClimat Arodus)  [Rova](!RollClimat Rova)  [Lamashan](!RollClimat Lamashan)   [Neth](!RollClimat Neth)   [Kuthona](!RollClimat Kuthona)}}");

} else if ((msg.type === "api") && (msgTxt.indexOf(cmdMois) !== -1)) {
    args = msgTxt.replace(cmdMois,'').trim().toLowerCase();
    if (args !== "")
    {
        mois = args;
        temperature = defineTemperatureRegion(region, mois);
        var clim = determinerClimat(region, temperature);
        sendChat(msgWho, "/w gm " + clim.ligne1);
        sendChat(msgWho, "/w gm " + clim.ligne2);
    }
    
}
});

//compute temperature with month and region
function defineTemperatureRegion(p_region, p_mois) {
    //log("region selected is " + p_region);
    //log("mois selected is " + p_mois);
    const climatTempereMin = new Map();
    climatTempereMin.set("abadius", -10);
    climatTempereMin.set("calistril", -5);
    climatTempereMin.set("pharast", 0);
    climatTempereMin.set("gozran", 5);
    climatTempereMin.set("desnus", 10);
    climatTempereMin.set("sarenith", 10);
    climatTempereMin.set("erastus", 15);
    climatTempereMin.set("arodus", 15);
    climatTempereMin.set("rova", 10);
    climatTempereMin.set("lamashan", 5);
    climatTempereMin.set("neth", 0);
    climatTempereMin.set("kuthona", -5);
    //log("mois/temp selected is " + climatTempereMin[p_mois]);
    var temperature = -1000;

    switch (region) {
        case "tres froid" :
            temperature = climatTempereMin.get(p_mois) + randomInteger(10) - 10;
            break;
        case "froid" :
            temperature = climatTempereMin.get(p_mois) + randomInteger(10) - 5;
            break;
        case "chaud" :
            temperature = climatTempereMin.get(p_mois) + randomInteger(10) + 5;
            break;
        case "tres chaud" :
            temperature = climatTempereMin.get(p_mois) + randomInteger(10) + 10;
            break;
        default:
            temperature = climatTempereMin.get(p_mois)
            break;
    }
    //log(temperature);
    return temperature;
    
}

function determinerClimat(p_region, p_temperature) {
    var roll = randomInteger(100);
    var ret = {ligne1 : "ligne1", ligne2 : "ligne2"};
    var temp = p_temperature;
    var temperatureNuit = temp - randomInteger(10);
    //log("il fait " + temp + "dans la région" + p_region);
    const climatFroid = new Map();
    const climatTempere = new Map();
    const climatDesert = new Map();
    var regionReduite= "";
    
    if (p_region == "tres froid" || p_region == "froid") {
        regionReduite = "froid";
    } else if (p_region == "tres chaud") {
        regionReduite = "desert";
    } else {
        regionReduite = "tempere";
    }

    if (roll <= 70) {
        ret.ligne1 = "Rien de particulier, temps calme.";
        ret.ligne2 = "Temperature = " + temp + ", la nuit = " + temperatureNuit;
    } else if (roll > 70 && roll <= 80) {
        var rollVague = randomInteger(100);
        var vague;
        switch (regionReduite) {
            case "froid":
                if (rollVague <= 30) {
                    vague = "chaleur";
                    temp += 5;
                } else {
                    temp -= 5;
                    vague = "froid";
                }
                ret.ligne1 = "Vague de " + vague + ".";
                ret.ligne2 = "Temperature = " + temp + ", la nuit = " + temperatureNuit;
                break;
            case "tempere":
                if (rollVague <= 50) {
                    temp += 5;
                    vague = "chaleur";
                } else {
                    temp -= 5;
                    vague = "froid";
                }
                ret.ligne1 = "Vague de " + vague + ".";
                ret.ligne2 = "Temperature = " + temp + ", la nuit = " + temperatureNuit;
                break;
            case "desert":
                ret.ligne1 = "Venteux : " + randomInteger(100)%2 ? "Vent moyen (15 à 30 km/h)" : "important (30 à 50 km/h).";
                ret.ligne2 = "Temperature = " + temp + ", la nuit = " + temperatureNuit;
                break;
            default:
                log("Valeur de regionReduit inconnue : " + regionReduite);
                break;
        }
    } else if (roll > 80 && roll <= 90) {
        var duree = randomInteger(4) + randomInteger(4);
        var dureegrele = randomInteger(20);
        switch (regionReduite) {
            case "froid":
            case "tempere":
                ret.ligne1 = precipitation();
                ret.ligne2 = "Temperature = " + temp + ", la nuit = " + temperatureNuit;
                break;
            case "desert":
                ret.ligne1 = "Venteux : " + randomInteger(100)%2 ? "Vent moyen (15 à 30 km/h)" : "important (30 à 50 km/h).";
                ret.ligne2 = "Temperature = " + temp + ", la nuit = " + temperatureNuit;
                break;
            default:
                log("Valeur de regionReduit inconnue : " + regionReduite);
                break;
        }
    } else if (roll > 90 && roll <= 91) {
        var tot =  randomInteger(4) + randomInteger(4) - 1;
        ret.ligne1 = "Tempête : les vents sont violents (50 à 80 km/h) et la visibilité diminuée de 75 %. Une tempête sévit pendant " + tot + "heures.";
        ret.ligne2 = "Temperature = " + temp + ", la nuit = " + temperatureNuit;
    } else {
        switch (regionReduite) {
            case "froid":
            case "tempere":
                ret.ligne1 = "Violente Tempête : la vitesse des vents s’élève au dessus de 80 km/h (voir la section sur les vents). De plus, il se joint aux blizzards (< 0°C) d’importantes chutes de neige " + randomInteger(3)*10 + " cm " + "et aux ouragans des trombes d’eau (voir ci-dessus). Un cyclone persiste pendant " + randomInteger(6) + " heures, un blizzard " + randomInteger(3) + " jours. Un ouragan peut parfois durer jusqu’à une semaine, mais il aura principalement de l’impact sur les personnages de vingt-quatre à quarante-huit heures, le temps que sa partie centrale traverse la région où se trouve le groupe. Quand à la tornade, elle possède une durée de vie extrêmement réduite " +  randomInteger(6)*10 + " minutes). Généralement, elle se forme dans le cadre d’un orage. Voir les sections sur les tempêtes et sur les vents.";
                ret.ligne2 = "Temperature = " + temp + ", la nuit = " + temperatureNuit;
                break;
            case "desert":
                var tot = randomInteger(4) + randomInteger(4);
                ret.ligne1 = "Trombes d’eau : semblables à la pluie (voir « Précipitations », ci-dessus), mais leur violence est telle qu’elles limitent le champ de vision comme le brouillard. Elles peuvent provoquer des inondations (voir Milieu aquatique). Les trombes d’eau durent pendant " + tot + " heures.";
                ret.ligne2 = "Temperature = " + temp + ", la nuit = " + temperatureNuit;
                break;
            default:
                log("Valeur de regionReduit inconnue : " + regionReduite);
                break;
        }
    }
    
    return ret;
    
}

function precipitation() {
    var precip = randomInteger(100);
    var ret = "undefinied"
    if (precip <= 30) {
        ret = "Brouillard";
    } else if (precip > 30 && precip <= 90) {
        ret = "Pluie/Neige";
    } else {
        ret = "Grêle/Neige fondue"
    }
    return ret;
}
