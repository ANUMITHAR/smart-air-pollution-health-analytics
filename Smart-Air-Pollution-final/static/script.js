let currentData = null;
let pollutionChart = null;
let travelMap = null;
let travelRouteLayer = null;
let travelMarkers = [];

const RISK_ORDER = { "Low": 1, "Moderate": 2, "High": 3, "Very High": 4 };

function showPage(id) {
    document.querySelectorAll(".page").forEach(page => page.classList.add("hidden"));
    const page = document.getElementById(id);
    if (page) page.classList.remove("hidden");
    window.scrollTo({ top: 0, behavior: "smooth" });
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function riskInfo(risk) {
    const data = {
        "Low": { icon: "🌿", text: "Pollution-related screening risk is currently low." },
        "Moderate": { icon: "🌤️", text: "Some pollution is present; sensitive people may need extra care." },
        "High": { icon: "⚠️", text: "Elevated pollution may increase potential health impacts." },
        "Very High": { icon: "🚨", text: "Very high pollution indicates increased potential health concern." }
    };
    return data[risk] || data["Moderate"];
}

function riskClass(risk) {
    return `risk-${String(risk || "moderate").toLowerCase().replace(" ", "-")}`;
}

function pollutantDefinitions(pollution) {
    return [
        { name: "PM2.5", key: "PM2.5", value: Number(pollution["PM2.5"]) || 0, limit: 15, icon: "🌫️", system: "Respiratory and cardiovascular systems", impact: "Fine particles can penetrate deep into the lungs and may contribute to respiratory and cardiovascular effects." },
        { name: "PM10", key: "PM10", value: Number(pollution.PM10) || 0, limit: 45, icon: "🌫️", system: "Respiratory system", impact: "Particulate matter may irritate the airways and contribute to breathing discomfort." },
        { name: "NO₂", key: "NO2", value: Number(pollution.NO2) || 0, limit: 25, icon: "🫁", system: "Respiratory system", impact: "Nitrogen dioxide may irritate the airways and aggravate respiratory symptoms." },
        { name: "O₃", key: "O3", value: Number(pollution.O3) || 0, limit: 100, icon: "🫁", system: "Respiratory system", impact: "Ozone can irritate the airways and may reduce lung function." },
        { name: "SO₂", key: "SO2", value: Number(pollution.SO2) || 0, limit: 40, icon: "🫁", system: "Respiratory system", impact: "Sulphur dioxide may cause airway irritation and breathing discomfort." },
        { name: "CO", key: "CO", value: Number(pollution.CO) || 0, limit: 4, icon: "❤️", system: "Oxygen delivery and cardiovascular system", impact: "Higher carbon monoxide exposure can reduce the blood's ability to carry oxygen." },
        { name: "NH₃", key: "NH3", value: Number(pollution.NH3) || 0, limit: 15.85, icon: "🧪", system: "Airway irritation", impact: "Elevated ammonia can irritate the eyes and airways." }
    ];
}

function getHealthImpacts(pollution) {
    const items = pollutantDefinitions(pollution)
        .map(item => ({ ...item, ratio: item.value / item.limit }))
        .sort((a, b) => b.ratio - a.ratio)
        .slice(0, 3);

    return items.map(item => `
        <article class="impact-card">
            <h3>${item.icon} ${item.name}</h3>
            <p><strong>Current level:</strong> ${item.value.toFixed(2)}</p>
            <p><strong>Potentially affected:</strong> ${escapeHtml(item.system)}</p>
            <p>${escapeHtml(item.impact)}</p>
        </article>
    `).join("");
}

function getPrecautions(risk, pollution) {
    const items = [];
    const pm25 = Number(pollution["PM2.5"]) || 0;
    const pm10 = Number(pollution.PM10) || 0;

    if (risk === "Low") {
        items.push(["🌿", "Continue normal activities while monitoring air-quality conditions."]);
        items.push(["💧", "Stay hydrated and maintain normal healthy habits."]);
    } else if (risk === "Moderate") {
        items.push(["🌤️", "Sensitive individuals should consider reducing prolonged outdoor exposure."]);
        items.push(["🏃", "Limit prolonged or strenuous outdoor activity when pollution is elevated."]);
        items.push(["😷", "A well-fitting protective mask can be considered during higher-pollution periods."]);
    } else if (risk === "High") {
        items.push(["😷", "Consider a well-fitting protective mask for outdoor exposure."]);
        items.push(["🏃", "Reduce prolonged or strenuous outdoor activity."]);
        items.push(["🏠", "Keep indoor air as clean as practical when outdoor pollution is elevated."]);
    } else {
        items.push(["🚨", "Minimize prolonged outdoor exposure while pollution is very high."]);
        items.push(["😷", "If outdoor exposure is necessary, consider a well-fitting protective mask."]);
        items.push(["🏃", "Avoid strenuous outdoor activity during very high pollution periods."]);
        items.push(["🏠", "Monitor air quality before going outdoors and keep indoor air as clean as practical."]);
    }

    if (pm25 > 35 || pm10 > 100) {
        items.push(["🌫️", "Particulate levels are elevated; avoid unnecessary long outdoor exposure."]);
    }

    return items.map(([icon, text]) => `<article class="precaution-card"><span>${icon}</span><p>${escapeHtml(text)}</p></article>`).join("");
}

function displayData(data) {
    if (!data || data.error) {
        throw new Error(data?.error || "No analysis data returned.");
    }

    currentData = data;
    const risk = data.health_risk;
    const info = riskInfo(risk);
    const title = data.location_name || data.location || "Selected Location";

    document.getElementById("current-location-name").textContent = title;
    document.getElementById("analysis-time").textContent = data.time ? `Modelled current conditions • ${data.time}` : "Modelled current conditions";
    document.getElementById("risk-level").textContent = risk;
    document.getElementById("risk-description").textContent = info.text;
    document.getElementById("risk-icon").textContent = info.icon;
    document.getElementById("risk-card").className = `risk-card ${riskClass(risk)}`;

    const p = data.pollution;
    document.getElementById("pm25").textContent = p["PM2.5"];
    document.getElementById("pm10").textContent = p.PM10;
    document.getElementById("no2").textContent = p.NO2;
    document.getElementById("nh3").textContent = p.NH3;
    document.getElementById("co").textContent = p.CO;
    document.getElementById("so2").textContent = p.SO2;
    document.getElementById("o3").textContent = p.O3;

    document.getElementById("health-impacts").innerHTML = getHealthImpacts(p);
    document.getElementById("precautions").innerHTML = getPrecautions(risk, p);
    loadForecast(data.latitude, data.longitude);
    showPage("current-page");
}

async function getJson(url) {
    const response = await fetch(url);
    let data;
    try { data = await response.json(); } catch { throw new Error("Server returned an invalid response."); }
    if (!response.ok || data.error) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
}

async function getLocation() {
    if (!navigator.geolocation) {
        alert("This browser does not support location access.");
        return;
    }

    showPage("current-page");
    document.getElementById("current-location-name").textContent = "Detecting location...";
    document.getElementById("risk-level").textContent = "Loading...";

    navigator.geolocation.getCurrentPosition(async position => {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;

        try {
            const air = await getJson(`/air-quality?lat=${lat}&lon=${lon}`);
            let place;
            try {
                place = await getJson(`/reverse-location?lat=${lat}&lon=${lon}`);
            } catch (error) {
                place = { location_name: `Coordinates ${lat.toFixed(4)}, ${lon.toFixed(4)}` };
            }
            air.location_name = place.location_name || place.location || "Selected Location";
            air.latitude = lat;
            air.longitude = lon;
            displayData(air);
        } catch (error) {
            console.error(error);
            document.getElementById("current-location-name").textContent = "Unable to analyze location";
            document.getElementById("risk-level").textContent = "--";
            alert(error.message);
        }
    }, error => {
        console.error(error);
        document.getElementById("current-location-name").textContent = "Location permission required";
        document.getElementById("risk-level").textContent = "--";
        alert("Please allow location access in the browser and try again.");
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
}

async function searchLocationAnalysis() {
    const input = document.getElementById("location-search");
    const query = input.value.trim();
    if (!query) { alert("Enter a city or town name."); return; }

    try {
        input.disabled = true;
        const data = await getJson(`/search-location?query=${encodeURIComponent(query)}`);
        displayData(data);
    } catch (error) {
        alert(error.message);
    } finally {
        input.disabled = false;
    }
}

async function loadForecast(lat, lon) {
    const box = document.getElementById("forecast-summary");
    box.textContent = "Loading next forecast hour...";
    try {
        const data = await getJson(`/forecast?lat=${lat}&lon=${lon}`);
        box.innerHTML = `
            <div><span>Forecast time</span><strong>${escapeHtml(new Date(data.forecast_time).toLocaleString())}</strong></div>
            <div><span>PM2.5</span><strong>${data.pollution["PM2.5"]} µg/m³</strong></div>
            <div><span>PM10</span><strong>${data.pollution.PM10} µg/m³</strong></div>
            <div><span>Screening risk</span><strong class="${riskClass(data.health_risk)}">${escapeHtml(data.health_risk)}</strong></div>
        `;
    } catch (error) {
        box.textContent = "Forecast unavailable right now.";
    }
}

function openTravelPage() {
    showPage("travel-page");
    document.getElementById("travel-result").innerHTML = "";
    if (currentData) document.getElementById("travel-from").value = currentData.location_name || "";
    resetTravelMap();
}

async function setTravelCurrentLocation() {
    if (currentData?.latitude && currentData?.longitude) {
        document.getElementById("travel-from").value = currentData.location_name || "Current Location";
        return;
    }

    if (!navigator.geolocation) { alert("Geolocation is not supported."); return; }

    navigator.geolocation.getCurrentPosition(async position => {
        try {
            const lat = position.coords.latitude;
            const lon = position.coords.longitude;
            const air = await getJson(`/air-quality?lat=${lat}&lon=${lon}`);
            let place = {};
            try { place = await getJson(`/reverse-location?lat=${lat}&lon=${lon}`); } catch {}
            air.location_name = place.location_name || `Coordinates ${lat.toFixed(4)}, ${lon.toFixed(4)}`;
            air.latitude = lat;
            air.longitude = lon;
            currentData = air;
            document.getElementById("travel-from").value = air.location_name;
        } catch (error) { alert(error.message); }
    }, () => alert("Please allow location access."), { enableHighAccuracy: true, timeout: 15000 });
}

function selectedMode() {
    return document.querySelector('input[name="travel-mode"]:checked')?.value || "car";
}

function modeName(mode) {
    return { car: "🚗 Car", bike: "🏍️ Two-Wheeler", bus: "🚌 Bus", train: "🚆 Train", walk: "🚶 Walking", cycle: "🚲 Bicycle" }[mode] || "🚗 Car";
}

function exposureText(mode) {
    return {
        walk: "Walking can involve direct outdoor exposure to ambient pollution.",
        cycle: "Cycling can involve direct outdoor exposure and increased breathing during exertion.",
        bike: "Two-wheeler travel involves direct outdoor exposure to ambient pollution.",
        car: "Car exposure varies with ventilation, traffic and cabin conditions.",
        bus: "Bus exposure varies with ventilation, traffic and surrounding conditions.",
        train: "Train exposure varies with train type, ventilation and surrounding conditions."
    }[mode] || "Exposure varies with travel conditions.";
}

async function searchForTravelLocation(query) {
    return getJson(`/search-location?query=${encodeURIComponent(query)}`);
}

function renderTravelResult(from, destination, analysis, mode) {
    const overall = analysis.overall_risk;
    const high = analysis.elevated_points;
    const highest = analysis.highest_risk_point;
    const highestTime = highest?.forecast_time ? new Date(highest.forecast_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "--";

    let recommendation;
    if (RISK_ORDER[overall] >= 4) recommendation = "Very high route risk screening. Consider postponing non-essential travel or choosing a time with better air quality when practical.";
    else if (RISK_ORDER[overall] >= 3) recommendation = "Elevated route risk screening. Reduce prolonged outdoor exposure and monitor conditions during the journey.";
    else if (RISK_ORDER[overall] === 2) recommendation = "Moderate route risk screening. Sensitive travellers should limit prolonged outdoor exposure and monitor air quality.";
    else recommendation = "Lower route risk screening based on the sampled forecast points. Continue normal precautions and monitor conditions.";

    const precautionList = [
        "😷 Carry a well-fitting protective mask.",
        "💧 Stay hydrated during the journey.",
        RISK_ORDER[overall] >= 2 ? "🏃 Reduce prolonged or strenuous outdoor activity in elevated-pollution areas." : "🌿 Normal outdoor activity is generally reasonable under the screening result.",
        (mode === "car" || mode === "bus") && RISK_ORDER[overall] >= 2 ? "🪟 Consider keeping vehicle windows closed in higher-pollution areas." : "📱 Monitor air-quality conditions during the journey."
    ];

    return `
        <div class="travel-overview">
            <div><span>FROM</span><strong>${escapeHtml(from.location_name)}</strong></div>
            <div class="arrow">→</div>
            <div><span>TO</span><strong>${escapeHtml(destination.location_name)}</strong></div>
            <div class="mode-pill">${modeName(mode)}</div>
        </div>

        <div class="route-metrics">
            <div><span>Distance</span><strong>${analysis.distance_km} km</strong></div>
            <div><span>Estimated road time</span><strong>${escapeHtml(analysis.duration_text)}</strong></div>
            <div><span>Route screening</span><strong class="${riskClass(overall)}">${escapeHtml(overall)}</strong></div>
            <div><span>Elevated points</span><strong>${analysis.elevated_points}/${analysis.sample_count}</strong></div>
        </div>

        <div class="route-analysis-grid">
            <article class="route-panel">
                <div class="panel-label">🫁 TRAVEL EXPOSURE</div>
                <p>${escapeHtml(exposureText(mode))}</p>
                <small>Exposure is screened from travel mode and modelled pollution conditions; it is not a personal dose measurement.</small>
            </article>
            <article class="route-panel">
                <div class="panel-label">⏱️ ETA FORECAST</div>
                <p>Average route PM2.5: <strong>${analysis.average_pm25} µg/m³</strong></p>
                <p>Maximum sampled PM2.5: <strong>${analysis.max_pm25} µg/m³</strong></p>
                <p>Highest-risk sampled point: <strong>${escapeHtml(highest.health_risk)}</strong> around <strong>${highestTime}</strong>.</p>
            </article>
        </div>

        <div class="route-recommendation">
            <div class="panel-label">🧠 ML ROUTE DECISION</div>
            <p>${escapeHtml(recommendation)}</p>
        </div>

        <div class="travel-comparison">
            <article class="travel-location-card start-card">
                <div class="panel-label">📍 STARTING LOCATION</div>
                <h3>${escapeHtml(from.location_name)}</h3>
                <strong class="${riskClass(from.health_risk)}">${escapeHtml(from.health_risk)}</strong>
                ${miniPollution(from.pollution)}
                <div class="mini-impact">${getHealthImpacts(from.pollution)}</div>
            </article>
            <article class="travel-location-card destination-card">
                <div class="panel-label">🏁 DESTINATION</div>
                <h3>${escapeHtml(destination.location_name)}</h3>
                <strong class="${riskClass(destination.health_risk)}">${escapeHtml(destination.health_risk)}</strong>
                ${miniPollution(destination.pollution)}
                <div class="mini-impact">${getHealthImpacts(destination.pollution)}</div>
            </article>
        </div>

        <div class="common-precautions">
            <div class="section-heading"><span>🛡️</span><div><h2>Travel Precautions</h2><p>Practical steps based on the route screening.</p></div></div>
            <div class="precaution-grid">${precautionList.map(x => `<article class="precaution-card"><span>${x.slice(0, 2)}</span><p>${escapeHtml(x.slice(2).trim())}</p></article>`).join("")}</div>
        </div>

        <div class="route-note">ℹ️ ${escapeHtml(analysis.note)}</div>
    `;
}

function miniPollution(p) {
    return `<div class="mini-pollution"><span>PM2.5 <b>${p["PM2.5"]}</b></span><span>PM10 <b>${p.PM10}</b></span><span>NO₂ <b>${p.NO2}</b></span><span>O₃ <b>${p.O3}</b></span></div>`;
}

async function compareTravel() {
    const fromQuery = document.getElementById("travel-from").value.trim();
    const destinationQuery = document.getElementById("destination").value.trim();
    const mode = selectedMode();
    const resultBox = document.getElementById("travel-result");

    if (!fromQuery || !destinationQuery) {
        resultBox.innerHTML = `<div class="error-box">Please enter both a starting location and destination.</div>`;
        return;
    }

    resultBox.innerHTML = `<div class="loading-box">🔎 Finding locations, route and ETA pollution forecast...</div>`;
    resetTravelMap();

    try {
        let from;
        if (currentData && currentData.location_name && fromQuery.toLowerCase() === currentData.location_name.toLowerCase()) {
            from = currentData;
        } else {
            from = await searchForTravelLocation(fromQuery);
        }
        const destination = await searchForTravelLocation(destinationQuery);

        const analysis = await getJson(
            `/route-analysis?from_lat=${encodeURIComponent(from.latitude)}` +
            `&from_lon=${encodeURIComponent(from.longitude)}` +
            `&to_lat=${encodeURIComponent(destination.latitude)}` +
            `&to_lon=${encodeURIComponent(destination.longitude)}` +
            `&mode=${encodeURIComponent(mode)}`
        );

        resultBox.innerHTML = renderTravelResult(from, destination, analysis, mode);
        renderTravelMap(from, destination, analysis);
        createPollutionChart(from, destination);
    } catch (error) {
        console.error(error);
        resultBox.innerHTML = `<div class="error-box">❌ ${escapeHtml(error.message || "Unable to analyze this journey.")}</div>`;
    }
}

function createPollutionChart(from, destination) {
    const section = document.getElementById("travel-chart-section");
    const canvas = document.getElementById("pollutionChart");
    section.classList.remove("hidden");

    if (pollutionChart) pollutionChart.destroy();

    pollutionChart = new Chart(canvas, {
        type: "bar",
        data: {
            labels: ["PM2.5", "PM10", "NO₂", "SO₂", "O₃"],
            datasets: [
                { label: from.location_name, data: [from.pollution["PM2.5"], from.pollution.PM10, from.pollution.NO2, from.pollution.SO2, from.pollution.O3] },
                { label: destination.location_name, data: [destination.pollution["PM2.5"], destination.pollution.PM10, destination.pollution.NO2, destination.pollution.SO2, destination.pollution.O3] }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: "top" } },
            scales: { y: { beginAtZero: true, title: { display: true, text: "Concentration (µg/m³)" } } }
        }
    });
}

function resetTravelMap() {
    document.getElementById("travel-map-section").classList.add("hidden");
    document.getElementById("travel-chart-section").classList.add("hidden");
    if (pollutionChart) { pollutionChart.destroy(); pollutionChart = null; }
    if (travelMap) {
        travelMap.remove();
        travelMap = null;
    }
    travelRouteLayer = null;
    travelMarkers = [];
}

function renderTravelMap(from, destination, analysis) {
    const section = document.getElementById("travel-map-section");
    section.classList.remove("hidden");

    if (travelMap) travelMap.remove();
    travelMap = L.map("travel-map");

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap contributors"
    }).addTo(travelMap);

    const coords = analysis.geometry?.coordinates || [];
    const latLngs = coords.map(([lon, lat]) => [lat, lon]);
    if (latLngs.length) {
        travelRouteLayer = L.polyline(latLngs, { weight: 5, opacity: 0.8 }).addTo(travelMap);
    }

    const start = L.marker([from.latitude, from.longitude]).addTo(travelMap).bindPopup(`<strong>Start</strong><br>${escapeHtml(from.location_name)}`);
    const end = L.marker([destination.latitude, destination.longitude]).addTo(travelMap).bindPopup(`<strong>Destination</strong><br>${escapeHtml(destination.location_name)}`);
    travelMarkers.push(start, end);

    (analysis.points || []).forEach(point => {
        const risk = point.health_risk;
        const marker = L.circleMarker([point.latitude, point.longitude], {
            radius: 7,
            weight: 2,
            fillOpacity: 0.85,
            className: `marker-${riskClass(risk)}`
        }).addTo(travelMap);
        marker.bindPopup(`
            <strong>Route sample</strong><br>
            ETA: ${Math.round(point.eta_minutes_from_start)} min<br>
            Risk: <strong>${escapeHtml(risk)}</strong><br>
            PM2.5: ${point.pollution["PM2.5"]} µg/m³
        `);
        travelMarkers.push(marker);
    });

    const bounds = L.latLngBounds([[from.latitude, from.longitude], [destination.latitude, destination.longitude]]);
    if (latLngs.length) latLngs.forEach(x => bounds.extend(x));
    travelMap.fitBounds(bounds.pad(0.12));
}

// Press Enter in search fields.
document.addEventListener("keydown", event => {
    if (event.key !== "Enter") return;
    if (document.activeElement?.id === "location-search") searchLocationAnalysis();
    if (document.activeElement?.id === "destination") compareTravel();
});

showPage("home-page");
