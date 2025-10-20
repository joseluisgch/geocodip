// Configuración Supabase
const supabaseUrl = 'https://btbunuottbejjimojjqx.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ0YnVudW90dGJlamppbW9qanF4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkyODU5NjEsImV4cCI6MjA3NDg2MTk2MX0.sKJWonaYz7mFRPvvDNBxGcimRUTrM55yONt0ccEGDE8';
const supabase = window.supabase.createClient(supabaseUrl, supabaseKey);

// Inicializar mapa
const map = L.map('map', { zoomControl: false }).setView([-12.0464, -77.0428], 12);

// Capas base
const baseLayers = {
    dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '© OpenStreetMap contributors © CARTO',
        subdomains: 'abcd',
        maxZoom: 19
    }),
    osm: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
    }),
    satellite: L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
        attribution: '© Esri',
        maxZoom: 19
    })
};

baseLayers.dark.addTo(map);

// Variables globales
const layers = {};
let aptitudeLayer = null;
let districtBoundariesLayer = null;
let currentAptitudeData = null;
let radarChart = null;
let normalizedData = null;
let hexagonLayers = {};
let currentRadarMode = 'all'; // 'all' o 'scenario'
let currentHexagonId = null; // Para recordar el hexágono actual

const variableWeights = {
    pob_ha: 0, eq2_edu_d: 0, eq4_esup_d: 0, eq6_salu_d: 0,
    eq8_come_d: 0, eq9_recre1: 0, eq9_recre_: 0, eq11_gas_m: 0,
    mo2_pdom_d: 0, mo4_pdoc_d: 0, eco3_proy: 0, sg1_delito: 0
};

const variableInfo = {
    pob_ha: { 
        name: 'Densidad Población', 
        short: 'Densidad', 
        positive: true,
        description: 'Mayor es mejor (INEI,2024)'
    },
    eq2_edu_d: { 
        name: 'Acceso a Colegios', 
        short: 'Colegios', 
        positive: false,
        description: 'Menor distancia es mejor (MINEDU,2024)'
    },
    eq4_esup_d: { 
        name: 'Acceso Educ. Superior', 
        short: 'Educ. Sup.', 
        positive: false,
        description: 'Menor distancia es mejor (MINEDU,2024)'
    },
    eq6_salu_d: { 
        name: 'Acceso a Salud', 
        short: 'Salud', 
        positive: false,
        description: 'Menor distancia es mejor (RENIPRESS,2024)'
    },
    eq8_come_d: { 
        name: 'Acceso a Comercios', 
        short: 'Comercios', 
        positive: false,
        description: 'Menor distancia es mejor (Google,2025)'
    },
    eq9_recre1: { 
        name: 'm² Recreación/hab', 
        short: 'Recr/hab', 
        positive: true,
        description: 'Mayor es mejor.'
    },
    eq9_recre_: { 
        name: 'm² Área Recreativa', 
        short: 'Á. Recr.', 
        positive: true,
        description: 'Mayor área es mejor (IMP,2023)'
    },
    eq11_gas_m: { 
        name: 'Infraestructura Gas', 
        short: 'Gas', 
        positive: true,
        description: 'Mayor cobertura es mejor (CALIDDA,2025).'
    },
    mo2_pdom_d: { 
        name: 'Transporte Masivo (Metro, Corredor)', 
        short: 't. Masivo', 
        positive: false,
        description: 'Menor distancia es mejor (ATU,2024).'
    },
    mo4_pdoc_d: { 
        name: 'Transporte Convencional (bus)', 
        short: 't. Conv.', 
        positive: false,
        description: 'Menor distancia es mejor (ATU,2024).'
    },
    eco3_proy: { 
        name: 'Inversión Proyectos', 
        short: 'Inversión', 
        positive: true,
        description: 'Mayor es mejor (MEF,2024)'
    },
    sg1_delito: { 
        name: 'Seguridad', 
        short: 'Seguridad', 
        positive: false,
        description: 'Menor número delitos (MININTER,2023).'
    }
};

const layerColors = {
    'fc_ec_valor_comerc_2019': '#D01E2F',
    'fc_eco_proyectos_activos_mef': '#D05D2F',
    'fc_eq_colegios_basica_minedu_2024': '#3182bd',
    'fc_eq_comercios_2025': '#a50f15',
    'fc_eq_educa_superior_minedu_2024': '#08519c',
    'fc_eq_recreativo_imp': '#70A800',
    'fc_eq_salud': '#18e0d6ff',
    'fc_mov_paraderos_tconvencional': '#AA00AE',
    'fc_mov_paraderos_tmasivo_atu': '#6600AE',
    'fc_mov_sistema_movilidad': '#8856a7',
    'fc_variables_normalizadas_sm_jm': '#888888',
    'fc_limite_distrital': '#FFFFFF'
};

const quintileColors = ['#FF0000', '#FF8000', '#FFFF00', '#80FF00', '#008000'];

// ==================== CARGAR LÍMITES DISTRITALES - NUEVO ====================
async function loadDistrictBoundaries() {
    try {
        console.log('Cargando límites distritales...');
        const { data, error } = await supabase
            .from('fc_limite_distrital')
            .select('*');
        
        if (error) throw error;
        if (!data || data.length === 0) {
            console.warn('No se encontraron límites distritales');
            return;
        }
        
        console.log('✅ Límites distritales cargados:', data.length);
        
        const features = [];
        const labels = [];
        
        data.forEach(item => {
            if (!item.geom) return;
            
            try {
                const latLngs = parseGeometry(item.geom, 'MULTIPOLYGON');
                if (!latLngs || latLngs.length === 0) return;
                
                // Crear polígono con estilo específico
                const polygon = L.polygon(latLngs, {
                    color: '#FFFFFF',
                    weight: 2,
                    opacity: 0.8,
                    fillOpacity: 0,
                    fillColor: 'transparent'
                });
                
                features.push(polygon);
                
                // Crear etiqueta si existe el nombre
                if (item.nombdist) {
                    // Calcular centroide para posicionar la etiqueta
                    const bounds = polygon.getBounds();
                    const center = bounds.getCenter();
                    
                    const label = L.marker(center, {
                        icon: L.divIcon({
                            className: 'district-label',
                            html: item.nombdist,
                            iconSize: [100, 20]
                        })
                    });
                    
                    labels.push(label);
                }
            } catch (e) {
                console.error('Error procesando límite distrital:', e);
            }
        });
        
        if (features.length > 0) {
            districtBoundariesLayer = L.featureGroup([...features, ...labels]);
            districtBoundariesLayer.addTo(map);
            layers['fc_limite_distrital'] = districtBoundariesLayer;
            
            console.log('✅ Límites distritales agregados al mapa');
            updateLegend();
        }
        
    } catch (error) {
        console.error('❌ Error cargando límites distritales:', error);
    }
}

// ==================== CARGAR DATOS NORMALIZADOS ====================
async function loadNormalizedData() {
    try {
        console.log('Cargando datos normalizados...');
        const { data, error } = await supabase
            .from('vw_variables_normalizadas_v2')
            .select('*');
        
        if (error) throw error;
        
        normalizedData = data.map(item => ({
            ...item,
            id_hexa350: String(item.id_hexa350)
        }));
        
        console.log('✅ Datos normalizados cargados:', normalizedData.length, 'registros');
        
        if (normalizedData.length > 0) {
            console.log('📋 Ejemplo de dato normalizado:', normalizedData[0]);
        }
    } catch (error) {
        console.error('❌ Error cargando datos normalizados:', error);
        showMessage('Error cargando datos normalizados', 'error');
    }
}

// ==================== GRÁFICO RADAR ====================
function initRadarChart() {
    const ctx = document.getElementById('radarCanvas');
    if (!ctx) return;
    
    radarChart = new Chart(ctx.getContext('2d'), {
        type: 'radar',
        data: {
            labels: Object.keys(variableInfo).map(key => variableInfo[key].short),
            datasets: [{
                label: 'Contribución (%)',
                data: new Array(12).fill(0),
                backgroundColor: 'rgba(99, 102, 241, 0.2)',
                borderColor: 'rgba(99, 102, 241, 1)',
                borderWidth: 2,
                pointBackgroundColor: 'rgba(99, 102, 241, 1)',
                pointBorderColor: '#fff',
                pointHoverBackgroundColor: '#fff',
                pointHoverBorderColor: 'rgba(99, 102, 241, 1)',
                pointRadius: 3,
                pointHoverRadius: 5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            scales: {
                r: {
                    beginAtZero: true,
                    max: 100,
                    min: 0,
                    ticks: {
                        stepSize: 20,
                        color: '#9ca3af',
                        backdropColor: 'transparent',
                        font: { size: 10 },
                        callback: (value) => value.toFixed(0) + '%'
                    },
                    grid: { color: 'rgba(255, 255, 255, 0.1)' },
                    angleLines: { color: 'rgba(255, 255, 255, 0.1)' },
                    pointLabels: {
                        color: '#e5e7eb',
                        font: { size: 10, weight: '500' }
                    }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(10, 14, 26, 0.95)',
                    titleColor: '#fff',
                    bodyColor: '#e5e7eb',
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    borderWidth: 1,
                    padding: 10,
                    callbacks: {
                        label: (context) => {
                            const varKey = Object.keys(variableInfo)[context.dataIndex];
                            const varName = variableInfo[varKey].name;
                            const weight = variableWeights[varKey];
                            return [
                                `${varName}`,
                                `Contribución: ${context.parsed.r.toFixed(2)}%`,
                                `Peso asignado: ${weight}%`
                            ];
                        }
                    }
                }
            },
            animation: {
                duration: 400,
                easing: 'easeInOutQuart'
            }
        }
    });
    
    console.log('✅ Gráfico radar inicializado');
}

function updateRadarChart(hexagonId, mode = null) {
    if (mode) currentRadarMode = mode;
    currentHexagonId = hexagonId;
    
    console.log('📊 Actualizando radar para hexágono:', hexagonId, 'Modo:', currentRadarMode);
    
    if (!radarChart) {
        console.error('❌ Radar chart no inicializado');
        return;
    }
    
    if (!normalizedData || normalizedData.length === 0) {
        console.warn('⚠️ No hay datos normalizados');
        radarChart.data.datasets[0].data = new Array(12).fill(0);
        radarChart.update();
        return;
    }
    
    let normalizedItem = normalizedData.find(item => item.id_hexa350 == hexagonId);
    
    if (!normalizedItem) {
        normalizedItem = normalizedData.find(item => 
            item.id_hexagono == hexagonId || 
            item.hexagono_id == hexagonId ||
            item.id == hexagonId
        );
    }
    
    if (!normalizedItem) {
        const hexIdNum = parseInt(hexagonId);
        normalizedItem = normalizedData.find(item => 
            parseInt(item.id_hexa350) === hexIdNum ||
            parseInt(item.id_hexagono) === hexIdNum ||
            parseInt(item.id) === hexIdNum
        );
    }
    
    if (!normalizedItem) {
        console.error('❌ No se encontraron datos normalizados para hexágono:', hexagonId);
        radarChart.data.datasets[0].data = new Array(12).fill(0);
        radarChart.update();
        return;
    }
    
    const aptitudeItem = currentAptitudeData ? currentAptitudeData.find(item => item.id_hexa350 == hexagonId) : null;
    const aptitudTotal = aptitudeItem ? aptitudeItem.aptitud_total : 0;
    
    const rawValues = [
        normalizedItem.pob_ha_norm || 0,
        normalizedItem.eq2_edu_d_norm || 0,
        normalizedItem.eq4_esup_d_norm || 0,
        normalizedItem.eq6_salu_d_norm || 0,
        normalizedItem.eq8_come_d_norm || 0,
        normalizedItem.eq9_recre1_norm || 0,
        normalizedItem.eq9_recre__norm || 0,
        normalizedItem.eq11_gas_m_norm || 0,
        normalizedItem.mo2_pdom_d_norm || 0,
        normalizedItem.mo4_pdoc_d_norm || 0,
        normalizedItem.eco3_proy_norm || 0,
        normalizedItem.sg1_delito_norm || 0
    ];
    
    const normalizedValuesPercentage = rawValues.map(v => v * 100);
    
    // Filtrar según el modo
    let dataToShow, labelsToShow;
    const allVariables = Object.keys(variableInfo);
    
    if (currentRadarMode === 'scenario') {
        // Solo mostrar variables con peso > 0
        const activeIndices = allVariables
            .map((key, index) => ({ key, index, weight: variableWeights[key] }))
            .filter(item => item.weight > 0);
        
        if (activeIndices.length === 0) {
            // Si no hay variables activas, mostrar mensaje
            radarChart.data.labels = ['Sin variables'];
            radarChart.data.datasets[0].data = [0];
            radarChart.update();
            
            const infoDiv = document.getElementById('radar-info');
            if (infoDiv) {
                infoDiv.innerHTML = `
                    <div style="font-size: 11px; color: var(--warning-color); text-align: center;">
                        ⚠️ No hay variables activas en el escenario
                    </div>
                `;
            }
            return;
        }
        
        labelsToShow = activeIndices.map(item => variableInfo[item.key].short);
        dataToShow = activeIndices.map(item => normalizedValuesPercentage[item.index]);
    } else {
        // Mostrar todas las variables
        labelsToShow = allVariables.map(key => variableInfo[key].short);
        dataToShow = normalizedValuesPercentage;
    }
    
    radarChart.data.labels = labelsToShow;
    radarChart.data.datasets[0].data = dataToShow;
    radarChart.data.datasets[0].label = 'Valor Normalizado (%)';
    radarChart.update('active');
    
    const infoDiv = document.getElementById('radar-info');
    if (infoDiv) {
        const modeText = currentRadarMode === 'scenario' ? 
            `Mostrando ${dataToShow.length} variable${dataToShow.length !== 1 ? 's' : ''} del escenario` :
            'Mostrando todas las variables (12)';
        
        infoDiv.innerHTML = `
            <div style="font-size: 11px; color: var(--text-secondary); text-align: center;">
                <strong style="color: #6366f1;">Aptitud Total: ${(aptitudTotal * 100).toFixed(2)}%</strong><br>
                <span style="color: var(--text-secondary);">
                    ${modeText}
                </span>
            </div>
        `;
    }
}

// ==================== RESUMEN DE VARIABLES - NUEVO ====================
function updateVariablesSummary() {
    const summaryContainer = document.getElementById('variables-summary');
    const summaryContent = document.getElementById('summary-content');
    
    if (!summaryContainer || !summaryContent) return;
    
    // Obtener variables activas (peso > 0)
    const activeVariables = Object.keys(variableWeights)
        .filter(key => variableWeights[key] > 0)
        .map(key => ({
            key,
            name: variableInfo[key].short,
            weight: variableWeights[key]
        }))
        .sort((a, b) => b.weight - a.weight);
    
    if (activeVariables.length === 0) {
        summaryContainer.style.display = 'none';
        return;
    }
    
    summaryContainer.style.display = 'block';
    
    let html = '';
    activeVariables.forEach(variable => {
        html += `
            <div class="summary-item">
                <span class="summary-var-name">${variable.name}</span>
                <span class="summary-var-weight">${variable.weight}%</span>
            </div>
        `;
    });
    
    summaryContent.innerHTML = html;
}

// ==================== RANKING DE DISTRITOS ====================
function updateDistrictRanking(data) {
    const container = document.getElementById('district-ranking');
    if (!data || data.length === 0) {
        container.innerHTML = '<p class="no-data">Calcule la aptitud para ver resultados</p>';
        return;
    }
    
    const districtData = {};
    data.forEach(item => {
        const district = item.nombdist || 'Sin distrito';
        if (!districtData[district]) {
            districtData[district] = { total: 0, count: 0 };
        }
        districtData[district].total += (item.aptitud_total || 0);
        districtData[district].count += 1;
    });
    
    const districtAverages = Object.keys(districtData).map(district => ({
        name: district,
        average: (districtData[district].total / districtData[district].count) * 100,
        count: districtData[district].count
    })).sort((a, b) => b.average - a.average);
    
    let html = '<div class="district-ranking">';
    districtAverages.forEach((district, index) => {
        html += `
            <div class="district-item">
                <span class="district-rank">#${index + 1}</span>
                <span class="district-name">${district.name} <small>(${district.count} hex)</small></span>
                <span class="district-score">${district.average.toFixed(1)}%</span>
            </div>
        `;
    });
    html += '</div>';
    
    container.innerHTML = html;
}

// ==================== CONTROL DE APTITUD - NUEVO ====================
function setupAptitudeControls() {
    const visibilityCheckbox = document.getElementById('aptitude-visibility');
    const opacitySlider = document.getElementById('aptitude-opacity');
    const opacityValue = document.getElementById('opacity-value');
    
    if (visibilityCheckbox) {
        visibilityCheckbox.addEventListener('change', function() {
            if (aptitudeLayer) {
                if (this.checked) {
                    aptitudeLayer.addTo(map);
                } else {
                    map.removeLayer(aptitudeLayer);
                }
                updateLegend();
            }
        });
    }
    
    if (opacitySlider && opacityValue) {
        opacitySlider.addEventListener('input', function() {
            const opacity = parseInt(this.value) / 100;
            opacityValue.textContent = this.value + '%';
            
            if (aptitudeLayer) {
                aptitudeLayer.eachLayer(function(layer) {
                    if (layer.setStyle) {
                        layer.setStyle({ fillOpacity: opacity * 0.6 });
                    }
                });
            }
        });
    }
}

// ==================== LEYENDA MEJORADA - ACTUALIZADA ====================
function updateLegend() {
    const legend = document.getElementById('legend');
    const content = document.getElementById('legend-content');
    if (!legend || !content) return;
    
    content.innerHTML = '';
    
    // Verificar si hay capa de aptitud
    const hasAptitude = currentAptitudeData && aptitudeLayer && map.hasLayer(aptitudeLayer);
    
    // Verificar otras capas activas
    const otherLayers = Object.keys(layers).filter(name => {
        const layer = layers[name];
        return layer && map.hasLayer(layer) && name !== 'aptitud_result';
    });
    
    if (!hasAptitude && otherLayers.length === 0) {
        legend.style.display = 'none';
        return;
    }
    
    legend.style.display = 'flex'; // Cambiar a flex para el nuevo layout
    
    // ============================================================
    // SECCIÓN 1: APTITUD - SIEMPRE PRIMERO SI EXISTE
    // ============================================================
    if (hasAptitude) {
        const quintiles = calculateQuintiles(currentAptitudeData);
        
        const aptitudeSection = document.createElement('div');
        aptitudeSection.className = 'legend-section';
        aptitudeSection.innerHTML = '<div class="legend-section-title">🎯 Aptitud Territorial</div>';
        
        const labels = [
            `Muy Baja (≤ ${(quintiles[0] * 100).toFixed(1)}%)`,
            `Baja (≤ ${(quintiles[1] * 100).toFixed(1)}%)`,
            `Media (≤ ${(quintiles[2] * 100).toFixed(1)}%)`,
            `Alta (≤ ${(quintiles[3] * 100).toFixed(1)}%)`,
            `Muy Alta (> ${(quintiles[3] * 100).toFixed(1)}%)`
        ];
        
        labels.forEach((label, i) => {
            const item = document.createElement('div');
            item.className = 'legend-item';
            item.innerHTML = `
                <div class="legend-color" style="background-color: ${quintileColors[i]}"></div>
                <span>${label}</span>
            `;
            aptitudeSection.appendChild(item);
        });
        
        content.appendChild(aptitudeSection);
    }
    
    // ============================================================
    // SECCIÓN 2: OTRAS CAPAS
    // ============================================================
    if (otherLayers.length > 0) {
        const othersSection = document.createElement('div');
        othersSection.className = 'legend-section';
        othersSection.innerHTML = '<div class="legend-section-title">📍 Otras Capas</div>';
        
        otherLayers.forEach(layerName => {
            const item = document.createElement('div');
            item.className = 'legend-item';
            
            const color = layerColors[layerName] || '#6366f1';
            const displayName = getLayerDisplayName(layerName);
            
            // Estilo especial para límites distritales
            if (layerName === 'fc_limite_distrital') {
                item.innerHTML = `
                    <div class="legend-color" style="background-color: transparent; border: 2px solid ${color}"></div>
                    <span>${displayName}</span>
                `;
            } else {
                item.innerHTML = `
                    <div class="legend-color" style="background-color: ${color}"></div>
                    <span>${displayName}</span>
                `;
            }
            
            othersSection.appendChild(item);
        });
        
        content.appendChild(othersSection);
    }
}

// ==================== FUNCIONES AUXILIARES ====================
function showMessage(message, type = 'error') {
    const container = document.getElementById('analysis-messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `${type}-message`;
    
    const icon = type === 'error' ? '❌' : type === 'success' ? '✅' : '⚠️';
    messageDiv.innerHTML = `<span>${icon}</span><span>${message}</span>`;
    
    container.appendChild(messageDiv);
    setTimeout(() => messageDiv.remove(), 5000);
}

function calculateQuintiles(data, field = 'aptitud_total') {
    const values = data.map(item => item[field] || 0).filter(val => val !== null);
    values.sort((a, b) => a - b);
    
    const quintiles = [];
    for (let i = 1; i < 5; i++) {
        quintiles.push(values[Math.floor((values.length * i) / 5)]);
    }
    return quintiles;
}

function getAptitudeColorByQuintile(value, quintiles) {
    if (value <= quintiles[0]) return quintileColors[0];
    if (value <= quintiles[1]) return quintileColors[1];
    if (value <= quintiles[2]) return quintileColors[2];
    if (value <= quintiles[3]) return quintileColors[3];
    return quintileColors[4];
}

function initializeVariableControls() {
    const container = document.getElementById('variable-controls');
    if (!container) return;
    
    container.innerHTML = '';
    
    Object.keys(variableInfo).forEach(variable => {
        const info = variableInfo[variable];
        const control = document.createElement('div');
        control.className = 'variable-control';
        control.innerHTML = `
            <div class="variable-header">
                <span class="variable-name">${info.name}</span>
                <span class="variable-weight" id="weight-${variable}">0%</span>
            </div>
            <input type="range" class="weight-slider" id="slider-${variable}" 
                   min="0" max="100" value="0" data-variable="${variable}">
            <div class="variable-info">
                ${info.description}
            </div>
        `;
        container.appendChild(control);
        
        const slider = control.querySelector(`#slider-${variable}`);
        slider.addEventListener('input', function() {
            updateVariableWeight(variable, parseInt(this.value));
        });
    });
    
    updateTotalWeight();
}


function updateVariableWeight(variable, value) {
    variableWeights[variable] = value;
    const weightElement = document.getElementById(`weight-${variable}`);
    if (weightElement) {
        weightElement.textContent = `${value}%`;
    }
    updateTotalWeight();
    updateVariablesSummary(); // Actualizar resumen
}

function updateTotalWeight() {
    const total = Object.values(variableWeights).reduce((sum, w) => sum + w, 0);
    const element = document.getElementById('total-weight');
    const btn = document.getElementById('calculate-btn');
    
    if (!element || !btn) return;
    
    element.textContent = `Total: ${total}%`;
    
    if (total <= 100) {
        element.className = 'total-weight valid';
        btn.disabled = total === 0;
    } else {
        element.className = 'total-weight invalid';
        btn.disabled = true;
    }
}

async function calculateAptitude() {
    try {
        showMessage('Calculando aptitud...', 'warning');
        
        const params = {};
        Object.keys(variableWeights).forEach(key => {
            params[`p_${key}`] = variableWeights[key] / 100;
        });
        
        console.log('📤 Parámetros enviados al backend:', params);
        
        const response = await fetch(`${supabaseUrl}/rest/v1/rpc/fun_suma_ponderada_aptitud_v2`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`
            },
            body: JSON.stringify(params)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || `Error ${response.status}`);
        }

        const result = await response.json();
        if (!result || result.length === 0) {
            showMessage('No se obtuvieron resultados');
            return;
        }
        
        console.log('📥 Resultados de aptitud recibidos:', result.length, 'registros');
        
        displayAptitudeResults(result);
        updateDistrictRanking(result);
        showMessage(`✅ Aptitud calculada para ${result.length} unidades`, 'success');
        
        // Mostrar control de aptitud
        const aptitudeControl = document.getElementById('aptitudeControl');
        if (aptitudeControl) {
            aptitudeControl.classList.add('active');
        }
        
    } catch (error) {
        console.error('Error:', error);
        showMessage('Error calculando aptitud: ' + error.message);
    }
}

function displayAptitudeResults(data) {
    if (aptitudeLayer) {
        map.removeLayer(aptitudeLayer);
    }
    
    currentAptitudeData = data;
    hexagonLayers = {};
    const quintiles = calculateQuintiles(data);
    const features = [];
    
    data.forEach(item => {
        if (!item.geom) return;
        
        try {
            const latLngs = parseGeometry(item.geom, 'MULTIPOLYGON');
            if (!latLngs) return;
            
            const aptValue = item.aptitud_total || 0;
            const color = getAptitudeColorByQuintile(aptValue, quintiles);
            
            const feature = L.polygon(latLngs, {
                color: color,
                weight: 1,
                fillColor: color,
                fillOpacity: 0.6
            }).bindPopup(createAptitudePopup(item));
            
            feature.on('mouseover', function(e) {
                if (item.id_hexa350) {
                    updateRadarChart(item.id_hexa350);
                    updateHexagonInfo(item);
                    
                    this.setStyle({
                        weight: 2,
                        opacity: 1
                    });
                }
            });
            
            feature.on('mouseout', function(e) {
                this.setStyle({
                    weight: 1,
                    opacity: 0.6
                });
            });
            
            features.push(feature);
            hexagonLayers[item.id_hexa350] = feature;
        } catch (e) {
            console.error('Error procesando geometría:', e);
        }
    });
    
    if (features.length > 0) {
        aptitudeLayer = L.featureGroup(features);
        layers['aptitud_result'] = aptitudeLayer;
        aptitudeLayer.addTo(map);
        
        // Resetear controles de visibilidad
        const visibilityCheckbox = document.getElementById('aptitude-visibility');
        if (visibilityCheckbox) visibilityCheckbox.checked = true;
        
        try {
            const bounds = aptitudeLayer.getBounds();
            if (bounds && bounds.isValid()) {
                map.fitBounds(bounds, { padding: [50, 50] });
            }
        } catch (e) {
            console.log('No se pudo hacer zoom automático');
        }
        
        updateLegend();
    }
}

function updateHexagonInfo(item) {
    const distrito = item.nombdist || 'N/A';
    const sector = item.grupos_cap || 'N/A';
    const aptitudTotal = item.aptitud_total ? 
        (item.aptitud_total * 100).toFixed(1) : 'N/A';
    
    document.getElementById('hexagon-info').innerHTML = `
        <p><strong>Hexágono:</strong> <span style="color: #6366f1;">${item.id_hexa350}</span></p>
        <p><strong>Distrito:</strong> ${distrito}</p>
        <p><strong>Sector:</strong> ${sector}</p>
        <p style="margin-top: 10px;"><strong>Aptitud Total:</strong></p>
        <div style="text-align: center; margin: 10px 0;">
            <span style="color: #6366f1; font-size: 32px; font-weight: 700;">${aptitudTotal}${aptitudTotal !== 'N/A' ? '%' : ''}</span>
        </div>
    `;
}

function createAptitudePopup(item) {
    const areaRecreativa = item.eq9_recre_ !== null && item.eq9_recre_ !== undefined ? 
        Math.round(item.eq9_recre_).toLocaleString() + ' m²' : 'N/A';
    
    return `
        <div style="max-width: 300px;">
            <b>Hexágono ${item.id_hexa350}</b><br>
            <b>Distrito:</b> ${item.nombdist || 'N/A'}<br>
            <b>Sector:</b> ${item.grupos_cap || 'N/A'}<br>
            <b>Población 2024:</b> ${item.tot_pob24 ? Math.round(item.tot_pob24).toLocaleString() : 'N/A'}<br>
            <hr>
            <b>Aptitud Total:</b> ${((item.aptitud_total || 0) * 100).toFixed(2)}%<br>
            <hr>
            <b>Indicadores:</b><br>
            • Densidad: ${item.pob_ha ? item.pob_ha.toFixed(2) : 'N/A'} hab/ha<br>
            • Dist. Colegios: ${item.eq2_edu_d ? item.eq2_edu_d.toFixed(0) + ' m' : 'N/A'}<br>
            • Dist. Educación Superior: ${item.eq4_esup_d ? item.eq4_esup_d.toFixed(0) + ' m' : 'N/A'}<br>
            • Dist. Salud: ${item.eq6_salu_d ? item.eq6_salu_d.toFixed(0) + ' m' : 'N/A'}<br>
            • Dist. Comercios: ${item.eq8_come_d ? item.eq8_come_d.toFixed(0) + ' m' : 'N/A'}<br>
            • m² Recreación/hab: ${item.eq9_recre1 ? item.eq9_recre1.toFixed(2) : 'N/A'}<br>
            • Área Recreativa Total: ${areaRecreativa}<br>
            • Infra. Gas: ${item.eq11_gas_m ? item.eq11_gas_m.toFixed(2) : 'N/A'}<br>
            • Dist. Paradero Masivo: ${item.mo2_pdom_d ? item.mo2_pdom_d.toFixed(0) + ' m' : 'N/A'}<br>
            • Dist. Paradero Conv.: ${item.mo4_pdoc_d ? item.mo4_pdoc_d.toFixed(0) + ' m' : 'N/A'}<br>
            • Inversión Proyectos: ${item.eco3_proy ? 'S/ ' + item.eco3_proy.toLocaleString() : 'N/A'}<br>
            • Delitos N°: ${item.sg1_delito ? item.sg1_delito.toFixed(2) : 'N/A'}
        </div>
    `;
}

function parseGeometry(geom, geometryType) {
    if (!geom) return null;
    if (geom.coordinates) return convertGeoJSONCoords(geom.coordinates, geometryType);
    if (typeof geom === 'string') return parseWKT(geom, geometryType);
    return null;
}

function convertGeoJSONCoords(coords, geometryType) {
    try {
        if (geometryType === 'MULTIPOLYGON') {
            return coords.map(polygon => 
                polygon.map(ring => 
                    ring.map(coord => [coord[1], coord[0]])
                )
            );
        } else if (geometryType === 'MULTILINESTRING') {
            return coords.map(line => line.map(coord => [coord[1], coord[0]]));
        } else if (geometryType === 'POINT') {
            return [coords[1], coords[0]];
        }
    } catch (e) {
        console.error('Error convirtiendo coordenadas:', e);
        return null;
    }
}

function parseWKT(wkt, geometryType) {
    try {
        if (geometryType === 'MULTIPOLYGON') {
            const match = wkt.match(/MULTIPOLYGON\s*\(\((.*)\)\)/);
            if (match) {
                const coordsText = match[1];
                const polygons = coordsText.split(')),((');
                return polygons.map(polygon => {
                    const rings = polygon.split('),(');
                    return rings.map(ring => {
                        const points = ring.split(',');
                        return points.map(point => {
                            const [lng, lat] = point.trim().split(' ');
                            return [parseFloat(lat), parseFloat(lng)];
                        });
                    });
                });
            }
        }
    } catch (e) {
        console.error('Error parseando WKT:', e);
    }
    return null;
}

// ==================== CARGAR CAPAS ====================
async function loadLayers() {
    try {
        const container = document.getElementById('layer-container');
        if (!container) return;
        
        container.innerHTML = '';
        
        const layerGroups = {
            'Economía': ['fc_ec_valor_comerc_2019', 'fc_eco_proyectos_activos_mef'],
            'Educación': ['fc_eq_colegios_basica_minedu_2024', 'fc_eq_educa_superior_minedu_2024'],
            'Salud': ['fc_eq_salud'],
            'Comercio': ['fc_eq_comercios_2025'],
            'Recreación': ['fc_eq_recreativo_imp'],
            'Movilidad': ['fc_mov_paraderos_tconvencional', 'fc_mov_paraderos_tmasivo_atu', 'fc_mov_sistema_movilidad'],
            'Cartografía Base': ['fc_variables_normalizadas_sm_jm', 'fc_limite_distrital']
        };
        
        for (const [groupName, tableNames] of Object.entries(layerGroups)) {
            const group = document.createElement('div');
            group.className = 'layer-group';
            
            const header = document.createElement('div');
            header.className = 'layer-group-header';
            header.innerHTML = `${groupName} <span>▶</span>`;
            
            const list = document.createElement('div');
            list.className = 'layer-list';
            
            group.appendChild(header);
            group.appendChild(list);
            container.appendChild(group);
            
            for (const tableName of tableNames) {
                await addLayerToGroup(tableName, list);
            }
            
            header.addEventListener('click', function() {
                const isExpanded = list.classList.contains('expanded');
                list.classList.toggle('expanded');
                header.querySelector('span').textContent = isExpanded ? '▶' : '▼';
            });
        }
    } catch (error) {
        console.error('Error cargando capas:', error);
    }
}

async function addLayerToGroup(tableName, container) {
    const item = document.createElement('div');
    item.className = 'layer-item';
    
    let geometryType = 'POINT';
    if (tableName === 'fc_eq_recreativo_imp' || 
        tableName === 'fc_variables_normalizadas_sm_jm' || 
        tableName === 'fc_limite_distrital') {
        geometryType = 'MULTIPOLYGON';
    } else if (tableName === 'fc_mov_sistema_movilidad') {
        geometryType = 'MULTILINESTRING';
    }
    
    // Marcar límites distritales como checked por defecto
    const isChecked = tableName === 'fc_limite_distrital' ? 'checked' : '';
    
    item.innerHTML = `
        <input type="checkbox" class="layer-checkbox" id="layer-${tableName}" ${isChecked}>
        <label class="layer-name" for="layer-${tableName}">${getLayerDisplayName(tableName)}</label>
    `;
    container.appendChild(item);
    
    const checkbox = item.querySelector('.layer-checkbox');
    checkbox.addEventListener('change', async function() {
        if (this.checked) {
            await loadLayerData(tableName, geometryType);
        } else {
            if (layers[tableName]) {
                map.removeLayer(layers[tableName]);
                delete layers[tableName];
                updateLegend();
            }
        }
    });
}

function getLayerDisplayName(tableName) {
    const names = {
        'fc_ec_valor_comerc_2019': 'Valor Comercial 2019',
        'fc_eco_proyectos_activos_mef': 'Proyectos MEF',
        'fc_eq_colegios_basica_minedu_2024': 'Colegios',
        'fc_eq_comercios_2025': 'Comercios',
        'fc_eq_educa_superior_minedu_2024': 'Educ. Superior',
        'fc_eq_recreativo_imp': 'Áreas Recreativas',
        'fc_eq_salud': 'Salud',
        'fc_mov_paraderos_tconvencional': 'Paraderos Conv.',
        'fc_mov_paraderos_tmasivo_atu': 'Paraderos Masivos',
        'fc_mov_sistema_movilidad': 'Sistema Movilidad',
        'fc_variables_normalizadas_sm_jm': 'Variables Normalizadas',
        'fc_limite_distrital': 'Límites Distritales'
    };
    return names[tableName] || tableName;
}

async function loadLayerData(tableName, geometryType) {
    try {
        const { data, error } = await supabase.from(tableName).select('*');
        if (error) throw error;
        if (data.length === 0) return;
        
        const features = [];
        const layerColor = layerColors[tableName] || '#3388ff';
        
        data.forEach(item => {
            let feature = null;
            
            if (geometryType === 'POINT') {
                let lat, lng;
                if (item.geom && item.geom.coordinates) {
                    [lng, lat] = item.geom.coordinates;
                } else if (item.y && item.x) {
                    lat = parseFloat(item.y);
                    lng = parseFloat(item.x);
                }
                
                if (lat && lng) {
                    feature = L.circleMarker([lat, lng], {
                        radius: 6,
                        fillColor: layerColor,
                        color: "#000",
                        weight: 1,
                        opacity: 1,
                        fillOpacity: 0.8
                    }).bindPopup(createPopupContent(tableName, item));
                }
                
            } else if (geometryType === 'MULTIPOLYGON') {
                if (item.geom) {
                    const latLngs = parseGeometry(item.geom, geometryType);
                    if (latLngs && latLngs.length > 0) {
                        // Estilo especial para límites distritales
                        if (tableName === 'fc_limite_distrital') {
                            feature = L.polygon(latLngs, {
                                color: layerColor,
                                weight: 2,
                                opacity: 0.8,
                                fillOpacity: 0,
                                fillColor: 'transparent'
                            }).bindPopup(createPopupContent(tableName, item));
                        } else {
                            feature = L.polygon(latLngs, {
                                color: layerColor,
                                weight: 2,
                                opacity: 0.7,
                                fillColor: layerColor,
                                fillOpacity: 0.3
                            }).bindPopup(createPopupContent(tableName, item));
                        }
                    }
                }
            } else if (geometryType === 'MULTILINESTRING') {
                if (item.geom) {
                    const latLngs = parseGeometry(item.geom, geometryType);
                    if (latLngs && latLngs.length > 0) {
                        feature = L.polyline(latLngs, {
                            color: layerColor,
                            weight: 4,
                            opacity: 0.7
                        }).bindPopup(createPopupContent(tableName, item));
                    }
                }
            }
            
            if (feature) features.push(feature);
        });
        
        if (features.length > 0) {
            const layer = L.layerGroup(features);
            layer.addTo(map);
            layers[tableName] = layer;
            updateLegend();
        }
        
    } catch (error) {
        console.error(`Error cargando ${tableName}:`, error);
    }
}

function createPopupContent(tableName, item) {
    let content = `<b>${getLayerDisplayName(tableName)}</b><br>`;
    if (item.nombre) content += `Nombre: ${item.nombre}<br>`;
    if (item.nombdist) content += `Distrito: ${item.nombdist}<br>`;
    return content;
}

// ==================== EXPORTAR KML MEJORADO - CON DATOS DE VARIABLES ====================
function exportToKML() {
    if (!currentAptitudeData || currentAptitudeData.length === 0) {
        showMessage('No hay datos de aptitud para exportar', 'warning');
        return;
    }
    
    const quintiles = calculateQuintiles(currentAptitudeData);
    
    // Obtener variables activas del escenario
    const activeVariables = Object.keys(variableWeights)
        .filter(key => variableWeights[key] > 0)
        .map(key => ({
            key,
            name: variableInfo[key].name,
            weight: variableWeights[key]
        }));
    
    // Crear descripción del escenario
    const scenarioDescription = activeVariables.length > 0 ? 
        activeVariables.map(v => `${v.name}: ${v.weight}%`).join(', ') :
        'Sin variables ponderadas';
    
    let kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Análisis de Aptitud Territorial - CODIP</name>
    <description>
      Resultados del análisis multicriterio
      Fecha: ${new Date().toLocaleDateString()}
      Variables del escenario: ${scenarioDescription}
    </description>
    
    <Style id="quintil1"><PolyStyle><color>ff0000ff</color></PolyStyle></Style>
    <Style id="quintil2"><PolyStyle><color>ff0080ff</color></PolyStyle></Style>
    <Style id="quintil3"><PolyStyle><color>ff00ffff</color></PolyStyle></Style>
    <Style id="quintil4"><PolyStyle><color>ff00ff80</color></PolyStyle></Style>
    <Style id="quintil5"><PolyStyle><color>ff008000</color></PolyStyle></Style>
    
    <Folder><name>Hexágonos con Aptitud</name>`;
    
    currentAptitudeData.forEach(item => {
        if (!item.geom) return;
        
        const aptValue = item.aptitud_total || 0;
        let quintilStyle = 'quintil3';
        
        if (aptValue <= quintiles[0]) quintilStyle = 'quintil1';
        else if (aptValue <= quintiles[1]) quintilStyle = 'quintil2';
        else if (aptValue <= quintiles[2]) quintilStyle = 'quintil3';
        else if (aptValue <= quintiles[3]) quintilStyle = 'quintil4';
        else quintilStyle = 'quintil5';
        
        try {
            const coords = extractCoordinatesFromGeom(item.geom);
            if (!coords) return;
            
            // Construir descripción estructurada
            let extendedDescription = `
          <b>═══════════════════════════════════════</b><br/>
          <b>HEXÁGONO ${item.id_hexa350}</b><br/>
          <b>═══════════════════════════════════════</b><br/>
          <br/>
          <b>📍 UBICACIÓN</b><br/>
          • Distrito: ${item.nombdist || 'N/A'}<br/>
          • Sector: ${item.grupos_cap || 'N/A'}<br/>
          • Población 2024: ${item.tot_pob24 ? Math.round(item.tot_pob24).toLocaleString() + ' hab' : 'N/A'}<br/>
          <br/>
          <b>🎯 APTITUD TOTAL: ${(aptValue * 100).toFixed(2)}%</b><br/>
          <br/>
          <b>📊 INDICADORES DEL ESCENARIO (Valores No Normalizados)</b><br/>`;
            
            // Agregar solo las variables activas con su peso y valor NO normalizado
            if (activeVariables.length > 0) {
                activeVariables.forEach(v => {
                    const varData = getVariableValue(item, v.key);
                    extendedDescription += `• ${v.name} [Peso: ${v.weight}%] → ${varData}<br/>`;
                });
            } else {
                extendedDescription += '<i>Sin variables ponderadas en este escenario</i><br/>';
            }
            
            extendedDescription += `
          <br/>
          <b>📋 INFORMACIÓN COMPLEMENTARIA</b><br/>`;
            
            // Agregar el resto de variables no incluidas en el escenario
            const activeKeys = new Set(activeVariables.map(v => v.key));
            const allVariableKeys = [
                { key: 'pob_ha', label: 'Densidad Población' },
                { key: 'eq2_edu_d', label: 'Dist. Colegios' },
                { key: 'eq4_esup_d', label: 'Dist. Educación Superior' },
                { key: 'eq6_salu_d', label: 'Dist. Salud' },
                { key: 'eq8_come_d', label: 'Dist. Comercios' },
                { key: 'eq9_recre1', label: 'm² Recreación/hab' },
                { key: 'eq9_recre_', label: 'Área Recreativa Total' },
                { key: 'eq11_gas_m', label: 'Infra. Gas' },
                { key: 'mo2_pdom_d', label: 'Dist. Paradero Masivo' },
                { key: 'mo4_pdoc_d', label: 'Dist. Paradero Conv.' },
                { key: 'eco3_proy', label: 'Inversión Proyectos' },
                { key: 'sg1_delito', label: 'Delitos' }
            ];
            
            const otherVariables = allVariableKeys.filter(v => !activeKeys.has(v.key));
            
            if (otherVariables.length > 0) {
                extendedDescription += '<i>Otras variables no incluidas en el escenario:</i><br/>';
                otherVariables.forEach(v => {
                    const varData = getVariableValue(item, v.key);
                    extendedDescription += `• ${v.label}: ${varData}<br/>`;
                });
            }
            
            kml += `
      <Placemark>
        <name>Hexágono ${item.id_hexa350} - ${(aptValue * 100).toFixed(1)}%</name>
        <description><![CDATA[${extendedDescription}]]></description>
        <styleUrl>#${quintilStyle}</styleUrl>
        <ExtendedData>
          <Data name="id_hexagono"><value>${item.id_hexa350}</value></Data>
          <Data name="aptitud_total"><value>${(aptValue * 100).toFixed(2)}</value></Data>
          <Data name="distrito"><value>${item.nombdist || ''}</value></Data>
          <Data name="sector"><value>${item.grupos_cap || ''}</value></Data>
          <Data name="poblacion_2024"><value>${item.tot_pob24 || 0}</value></Data>`;
            
            // Agregar ExtendedData para las variables activas
            activeVariables.forEach(v => {
                const value = item[v.key] || 0;
                kml += `
          <Data name="${v.key}"><value>${value}</value></Data>
          <Data name="${v.key}_peso"><value>${v.weight}</value></Data>`;
            });
            
            kml += `
        </ExtendedData>
        <Polygon>
          <outerBoundaryIs>
            <LinearRing>
              <coordinates>${coords}</coordinates>
            </LinearRing>
          </outerBoundaryIs>
        </Polygon>
      </Placemark>`;
        } catch (e) {
            console.error('Error KML:', e);
        }
    });
    
    kml += `</Folder></Document></kml>`;
    
    const blob = new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    
    // Nombre del archivo con fecha y hora
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:]/g, '-');
    a.download = `aptitud_territorial_${timestamp}.kml`;
    a.click();
    URL.revokeObjectURL(url);
    
    showMessage('✅ Archivo KML exportado con datos completos', 'success');
}

// Función auxiliar para obtener valor de variable formateado
function getVariableValue(item, varKey) {
    const value = item[varKey];
    if (value === null || value === undefined) return 'N/A';
    
    // Formatear según el tipo de variable
    if (varKey.includes('_d')) {
        // Distancias en metros
        return Math.round(value).toLocaleString() + ' m';
    } else if (varKey === 'pob_ha') {
        return value.toFixed(2) + ' hab/ha';
    } else if (varKey === 'eq9_recre1') {
        return value.toFixed(2) + ' m²/hab';
    } else if (varKey === 'eq9_recre_') {
        return Math.round(value).toLocaleString() + ' m²';
    } else if (varKey === 'eco3_proy') {
        return 'S/ ' + value.toLocaleString();
    } else if (varKey === 'sg1_delito') {
        return value.toFixed(2) + ' delitos';
    } else if (varKey === 'eq11_gas_m') {
        return value.toFixed(2);
    }
    
    return value.toFixed(2);
}

function extractCoordinatesFromGeom(geom) {
    try {
        let coords = null;
        
        if (geom.coordinates) {
            coords = geom.coordinates[0][0];
        } else if (typeof geom === 'string') {
            const match = geom.match(/MULTIPOLYGON\s*\(\(\((.*?)\)\)\)/);
            if (match) {
                const coordsText = match[1];
                const points = coordsText.split(',');
                coords = points.map(point => {
                    const [lng, lat] = point.trim().split(' ');
                    return [parseFloat(lng), parseFloat(lat)];
                });
            }
        }
        
        if (!coords) return null;
        
        return coords.map(coord => {
            const lng = Array.isArray(coord) ? coord[0] : coord[1];
            const lat = Array.isArray(coord) ? coord[1] : coord[0];
            return `${lng},${lat},0`;
        }).join('\n                ');
        
    } catch (e) {
        console.error('Error extrayendo coordenadas:', e);
        return null;
    }
}

// ==================== EVENT LISTENERS ====================
document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 Inicializando Geoportal CODIP Mejorado...');
    
    initializeVariableControls();
    initRadarChart();
    loadNormalizedData();
    loadLayers();
    loadDistrictBoundaries(); // Cargar límites al inicio
    setupAptitudeControls();
    updateVariablesSummary(); // Inicializar resumen (vacío al inicio)
    
    const calculateBtn = document.getElementById('calculate-btn');
    if (calculateBtn) {
        calculateBtn.addEventListener('click', calculateAptitude);
    }
    
    const resetBtn = document.getElementById('reset-btn');
    if (resetBtn) {
        resetBtn.addEventListener('click', function() {
            Object.keys(variableWeights).forEach(variable => {
                variableWeights[variable] = 0;
                const slider = document.getElementById(`slider-${variable}`);
                const weight = document.getElementById(`weight-${variable}`);
                if (slider) slider.value = 0;
                if (weight) weight.textContent = '0%';
            });
            updateTotalWeight();
            updateVariablesSummary(); // Limpiar resumen
            
            // Resetear radar
            currentHexagonId = null;
            currentRadarMode = 'all';
            document.querySelectorAll('.radar-tab').forEach(t => t.classList.remove('active'));
            document.querySelector('.radar-tab[data-mode="all"]').classList.add('active');
            
            if (radarChart) {
                radarChart.data.datasets[0].data = new Array(12).fill(0);
                radarChart.data.labels = Object.keys(variableInfo).map(key => variableInfo[key].short);
                radarChart.update();
            }
            
            document.getElementById('hexagon-info').innerHTML = 
                '<p class="no-selection">Pase el cursor sobre un hexágono</p>';
            document.getElementById('district-ranking').innerHTML = 
                '<p class="no-data">Calcule la aptitud para ver resultados</p>';
                
            if (aptitudeLayer) {
                map.removeLayer(aptitudeLayer);
                aptitudeLayer = null;
            }
            currentAptitudeData = null;
            hexagonLayers = {};
            
            // Ocultar control de aptitud
            const aptitudeControl = document.getElementById('aptitudeControl');
            if (aptitudeControl) {
                aptitudeControl.classList.remove('active');
            }
            
            updateLegend();
        });
    }
    
    const zoomInBtn = document.getElementById('zoom-in');
    const zoomOutBtn = document.getElementById('zoom-out');
    if (zoomInBtn) zoomInBtn.addEventListener('click', () => map.zoomIn());
    if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => map.zoomOut());
    
    document.querySelectorAll('.base-layer-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const layerType = this.getAttribute('data-layer');
            
            Object.values(baseLayers).forEach(layer => {
                if (map.hasLayer(layer)) map.removeLayer(layer);
            });
            
            baseLayers[layerType].addTo(map);
            
            document.querySelectorAll('.base-layer-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
        });
    });
    
    const btnLayers = document.getElementById('btn-layers');
    const layersModal = document.getElementById('layersModal');
    const closeLayersModal = document.getElementById('closeLayersModal');
    
    if (btnLayers && layersModal) {
        btnLayers.addEventListener('click', () => layersModal.classList.add('active'));
    }
    
    if (closeLayersModal && layersModal) {
        closeLayersModal.addEventListener('click', () => layersModal.classList.remove('active'));
    }
    
    if (layersModal) {
        layersModal.addEventListener('click', function(e) {
            if (e.target === this) this.classList.remove('active');
        });
    }
    
    const btnScenarios = document.getElementById('btn-scenarios');
    if (btnScenarios) {
        btnScenarios.addEventListener('click', exportToKML);
    }
    
    // Event listeners para pestañas del radar - NUEVO
    document.querySelectorAll('.radar-tab').forEach(tab => {
        tab.addEventListener('click', function() {
            const mode = this.getAttribute('data-mode');
            
            // Actualizar pestañas activas
            document.querySelectorAll('.radar-tab').forEach(t => t.classList.remove('active'));
            this.classList.add('active');
            
            // Actualizar gráfico si hay un hexágono seleccionado
            if (currentHexagonId) {
                updateRadarChart(currentHexagonId, mode);
            }
        });
    });
    
    // Event listeners para colapsar controles - NUEVO
    const aptitudeHeader = document.getElementById('aptitudeHeader');
    const aptitudeCollapseBtn = document.getElementById('aptitudeCollapseBtn');
    const aptitudeControl = document.getElementById('aptitudeControl');
    
    if (aptitudeHeader && aptitudeCollapseBtn) {
        aptitudeHeader.addEventListener('click', function() {
            aptitudeControl.classList.toggle('collapsed');
            const icon = aptitudeCollapseBtn.querySelector('i');
            if (aptitudeControl.classList.contains('collapsed')) {
                icon.className = 'fas fa-chevron-down';
            } else {
                icon.className = 'fas fa-chevron-up';
            }
        });
    }
    
    const legendHeader = document.getElementById('legendHeader');
    const legendCollapseBtn = document.getElementById('legendCollapseBtn');
    const legend = document.getElementById('legend');
    
    if (legendHeader && legendCollapseBtn) {
        legendHeader.addEventListener('click', function() {
            legend.classList.toggle('collapsed');
            const icon = legendCollapseBtn.querySelector('i');
            if (legend.classList.contains('collapsed')) {
                icon.className = 'fas fa-chevron-up';
            } else {
                icon.className = 'fas fa-chevron-down';
            }
        });
    }
    
    console.log('✅ Geoportal inicializado correctamente');
});