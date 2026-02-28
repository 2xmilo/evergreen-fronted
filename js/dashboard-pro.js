// ========================================
// EVERGREEN DATA-APP - LOGICA DEL DASHBOARD PRO
// ========================================

const PRODUCT_METADATA = {
    'CHIRPS': {
        fullName: 'Climate Hazards Group InfraRed Precipitation with Station data',
        resolution: '5km',
        temporal: '1981-presente',
        frequency: 'Diaria',
        description: 'Dataset ideal para análisis histórico de precipitaciones y tendencias climáticas.'
    },
    'GPM': {
        fullName: 'Global Precipitation Measurement (IMERG)',
        resolution: '10km',
        temporal: '2000-presente',
        frequency: 'Media hora',
        description: 'Datos satelitales de alta frecuencia para análisis de tormentas y patrones de lluvia intensos.'
    },
    'ERA5': {
        fullName: 'ERA5 Reanalysis (ECMWF)',
        resolution: '9km',
        temporal: '1950-presente',
        frequency: 'Horaria',
        description: 'Reanálisis climático global de última generación.'
    },
    'PERSIANN': {
        fullName: 'PERSIANN - Climate Data Record',
        resolution: '25km',
        temporal: '1983-presente',
        frequency: 'Diaria',
        description: 'Estimación de precipitación a partir de redes neuronales artificiales.'
    },
    'CMORPH': {
        fullName: 'NOAA CPC Morphing Technique',
        resolution: '25km',
        temporal: '1998-presente',
        frequency: 'Media hora',
        description: 'Estimaciones globales de precipitación con microondas pasivas.'
    },
    'T_MAX': {
        fullName: 'Temperatura Máxima a 2m (ERA5-Land)',
        resolution: '9km',
        temporal: '1950-presente',
        frequency: 'Diaria',
        description: 'Datos de temperatura máxima diaria del aire cerca de la superficie.'
    },
    'T_MIN': {
        fullName: 'Temperatura Mínima a 2m (ERA5-Land)',
        resolution: '9km',
        temporal: '1950-presente',
        frequency: 'Diaria',
        description: 'Datos de temperatura mínima diaria del aire cerca de la superficie.'
    },
    'T_MEAN': {
        fullName: 'Temperatura Media a 2m (ERA5-Land)',
        resolution: '9km',
        temporal: '1950-presente',
        frequency: 'Diaria',
        description: 'Datos de temperatura media diaria del aire cerca de la superficie.'
    }
};

// Sistema de Acordeones
function toggleAccordion(sectionId) {
    const allSections = document.querySelectorAll('.accordion-section');
    const targetSection = document.getElementById(`accordion-${sectionId}`);

    // Cerrar los que no son el objetivo
    allSections.forEach(section => {
        if (section !== targetSection && section.classList.contains('open')) {
            section.classList.remove('open');
        }
    });

    // Toggle el objetivo
    targetSection.classList.toggle('open');
}

// Inicializar el primer acordeón como abierto por defecto
document.addEventListener('DOMContentLoaded', () => {
    const ubicacionesAccordion = document.getElementById('accordion-ubicaciones');
    if (ubicacionesAccordion) {
        ubicacionesAccordion.classList.add('open');
    }

    // Agregar hover para metadatos en checkboxes
    document.querySelectorAll('.checkbox-group label').forEach(label => {
        const checkbox = label.querySelector('input[type="checkbox"]');
        if (checkbox && PRODUCT_METADATA[checkbox.value]) {
            label.title = PRODUCT_METADATA[checkbox.value].description;
        }
    });
});

// Corrección de bug de Leaflet layer control que encontramos antes
// initMap ya carga controlCapas
