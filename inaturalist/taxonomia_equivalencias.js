export const SYNONYMS = {
    // Flora
    "Drimys winteri": "Drimys winteri var. winteri",
    "Archidasyphyllum excelsum": "Dasyphyllum excelsum",

    // Fauna
    "Puma concolor": "Puma concolor",
    "Lycalopex culpaeus": "Pseudalopex culpaeus", // Zorro culpeo en RCE
    "Lycalopex griseus": "Pseudalopex griseus",
    "Lontra felina": "Lontra felina",
    "Leopardus guigna": "Leopardus guigna"
};

export const CITES_GENERA = [
    "Alstroemeria", "Araucaria", "Fitzroya", "Pilgerodendron", "Guaiacum"
];

export const SPECIAL_CASES = {
    "Araucaria araucana": "Monumento Natural",
    "Fitzroya cupressoides": "Monumento Natural",
    "Gomortega keule": "Monumento Natural",
    "Pitavia punctata": "Monumento Natural",
    "Ruil": "Monumento Natural",
    "Nothofagus alessandrii": "Monumento Natural"
};

export function getOfficialName(inatName) {
    // Primero limpieza básica
    let name = inatName.trim();
    // Revisa si es un sinónimo directo
    if (SYNONYMS[name]) {
        return SYNONYMS[name];
    }
    return name;
}

export function checkSpecialProtection(sciName) {
    let result = { status: null, type: null };

    // 1. Revisar si es Monumento Natural
    if (SPECIAL_CASES[sciName]) {
        result.status = SPECIAL_CASES[sciName];
        result.type = "Monumento Natural";
        return result;
    }

    // 2. Revisar CITES por género
    let genus = sciName.split(" ")[0];
    if (CITES_GENERA.includes(genus)) {
        result.status = "CITES Apéndice II (Género)";
        result.type = "CITES";
        return result;
    }

    return null;
}
