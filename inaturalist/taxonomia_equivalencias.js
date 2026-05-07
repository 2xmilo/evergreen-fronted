export const SYNONYMS = {
    // Flora
    "drimys winteri": "drimys winteri var. winteri",
    "archidasyphyllum excelsum": "dasyphyllum excelsum",

    // Fauna
    "puma concolor": "puma concolor",
    "lycalopex culpaeus": "pseudalopex culpaeus", // Zorro culpeo en RCE
    "lycalopex griseus": "pseudalopex griseus",
    "lontra felina": "lontra felina",
    "leopardus guigna": "leopardus guigna"
};

export const CITES_GENERA = [
    "alstroemeria", "araucaria", "fitzroya", "pilgerodendron", "guaiacum"
];

export const SPECIAL_CASES = {
    "araucaria araucana": "Monumento Natural",
    "fitzroya cupressoides": "Monumento Natural",
    "gomortega keule": "Monumento Natural",
    "pitavia punctata": "Monumento Natural",
    "ruil": "Monumento Natural",
    "nothofagus alessandrii": "Monumento Natural"
};

export function getOfficialName(inatName) {
    const name = normalizeScientificName(inatName);
    return SYNONYMS[name] || name;
}

export function checkSpecialProtection(sciName) {
    const normalizedName = normalizeScientificName(sciName);

    if (SPECIAL_CASES[normalizedName]) {
        return {
            status: SPECIAL_CASES[normalizedName],
            type: "Monumento Natural"
        };
    }

    const genus = normalizedName.split(" ")[0];
    if (CITES_GENERA.includes(genus)) {
        return {
            status: "CITES Apéndice II (Género)",
            type: "CITES"
        };
    }

    return null;
}

function normalizeScientificName(name) {
    return String(name || '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();
}
