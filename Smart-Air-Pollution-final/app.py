from flask import Flask, render_template, jsonify, request
import joblib
import requests
import math
from datetime import datetime, timezone

app = Flask(__name__)

# ------------------------------------------------------------
# MACHINE-LEARNING MODEL
# ------------------------------------------------------------
model = joblib.load("random_forest_model.pkl")
features = joblib.load("features.pkl")

NH3_FALLBACK = 15.85
AIR_QUALITY_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"
GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search"
NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse"
OSRM_URL = "https://router.project-osrm.org/route/v1/driving"

MODE_NAMES = {
    "car": "Car",
    "bike": "Two-Wheeler",
    "bus": "Bus",
    "train": "Train",
    "walk": "Walking",
    "cycle": "Bicycle",
}

RISK_SCORE = {
    "Low": 1,
    "Moderate": 2,
    "High": 3,
    "Very High": 4,
}


# ------------------------------------------------------------
# COMMON HELPERS
# ------------------------------------------------------------
def safe_float(value, default=0.0):
    try:
        value = float(value)
        if math.isfinite(value):
            return value
    except (TypeError, ValueError):
        pass
    return default


def normalize_pollution(raw):
    """Convert API values to the same units used by the ML model."""
    pm25 = safe_float(raw.get("pm2_5"))
    pm10 = safe_float(raw.get("pm10"))
    no2 = safe_float(raw.get("nitrogen_dioxide"))
    nh3 = raw.get("ammonia")
    nh3 = NH3_FALLBACK if nh3 is None else safe_float(nh3, NH3_FALLBACK)
    co = safe_float(raw.get("carbon_monoxide")) / 1000.0  # µg/m³ -> mg/m³
    so2 = safe_float(raw.get("sulphur_dioxide"))
    o3 = safe_float(raw.get("ozone"))

    return {
        "PM2.5": round(pm25, 2),
        "PM10": round(pm10, 2),
        "NO2": round(no2, 2),
        "NH3": round(nh3, 2),
        "CO": round(co, 3),
        "SO2": round(so2, 2),
        "O3": round(o3, 2),
    }


def predict_risk(pollution):
    """Run the saved Random Forest model using the saved feature order."""
    values = {
        "PM2.5": pollution["PM2.5"],
        "PM10": pollution["PM10"],
        "NO2": pollution["NO2"],
        "NH3": pollution["NH3"],
        "CO": pollution["CO"],
        "SO2": pollution["SO2"],
        "O3": pollution["O3"],
    }

    model_input = [[safe_float(values.get(feature)) for feature in features]]
    return str(model.predict(model_input)[0])


def get_current_air_quality(latitude, longitude):
    params = {
        "latitude": latitude,
        "longitude": longitude,
        "current": (
            "pm2_5,pm10,nitrogen_dioxide,ammonia,"
            "carbon_monoxide,sulphur_dioxide,ozone"
        ),
        "timezone": "auto",
    }

    response = requests.get(AIR_QUALITY_URL, params=params, timeout=20)
    response.raise_for_status()
    data = response.json()
    current = data.get("current", {})

    pollution = normalize_pollution(current)
    return {
        "pollution": pollution,
        "health_risk": predict_risk(pollution),
        "latitude": latitude,
        "longitude": longitude,
        "time": current.get("time"),
    }


def geocode_location(query):
    params = {
        "name": query,
        "count": 1,
        "language": "en",
        "format": "json",
    }

    response = requests.get(GEOCODING_URL, params=params, timeout=20)
    response.raise_for_status()
    results = response.json().get("results", [])

    if not results:
        raise ValueError(f"Location '{query}' was not found.")

    location = results[0]
    latitude = safe_float(location.get("latitude"))
    longitude = safe_float(location.get("longitude"))
    name = location.get("name", query)
    state = location.get("admin1", "")
    country = location.get("country", "")

    display_name = name
    if state and state.lower() != name.lower():
        display_name += f", {state}"

    return {
        "name": name,
        "state": state,
        "country": country,
        "display_name": display_name,
        "latitude": latitude,
        "longitude": longitude,
    }


def reverse_geocode(latitude, longitude):
    params = {
        "lat": latitude,
        "lon": longitude,
        "format": "json",
        "zoom": 10,
        "addressdetails": 1,
    }
    headers = {
        "User-Agent": "Smart-Air-Pollution-Health-Impact-Analytics/1.0"
    }

    response = requests.get(
        NOMINATIM_URL,
        params=params,
        headers=headers,
        timeout=20,
    )
    response.raise_for_status()
    data = response.json()
    address = data.get("address", {})

    city = (
        address.get("city")
        or address.get("town")
        or address.get("municipality")
        or address.get("village")
        or address.get("county")
        or address.get("state_district")
    )

    state = address.get("state", "")
    country = address.get("country", "")

    if not city:
        raise ValueError("A city/town name could not be resolved for these coordinates.")

    display_name = city
    if state:
        display_name += f", {state}"

    return {
        "location_name": display_name,
        "location": city,
        "state": state,
        "country": country,
        "display_name": data.get("display_name", display_name),
        "latitude": latitude,
        "longitude": longitude,
    }


def haversine_km(a, b):
    lon1, lat1 = a
    lon2, lat2 = b
    radius = 6371.0

    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)

    x = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return radius * 2 * math.atan2(math.sqrt(x), math.sqrt(1 - x))


def sample_route_coordinates(coordinates, count=7):
    if not coordinates:
        return []

    if len(coordinates) <= count:
        return coordinates

    cumulative = [0.0]
    for i in range(1, len(coordinates)):
        cumulative.append(
            cumulative[-1] + haversine_km(coordinates[i - 1], coordinates[i])
        )

    total = cumulative[-1]
    if total <= 0:
        return [coordinates[0], coordinates[-1]]

    selected = []
    for i in range(count):
        target = total * i / (count - 1)
        nearest_index = min(
            range(len(cumulative)),
            key=lambda idx: abs(cumulative[idx] - target),
        )
        selected.append(coordinates[nearest_index])

    # Remove accidental duplicates while preserving order.
    result = []
    for point in selected:
        if not result or point != result[-1]:
            result.append(point)
    return result


def route_geometry(from_lat, from_lon, to_lat, to_lon):
    url = f"{OSRM_URL}/{from_lon},{from_lat};{to_lon},{to_lat}"
    params = {
        "overview": "full",
        "geometries": "geojson",
        "steps": "false",
        "alternatives": "false",
    }

    response = requests.get(url, params=params, timeout=30)
    response.raise_for_status()
    data = response.json()

    if data.get("code") != "Ok" or not data.get("routes"):
        raise ValueError("A road route could not be found between the locations.")

    route = data["routes"][0]
    geometry = route.get("geometry") or {"type": "LineString", "coordinates": []}

    return {
        "distance_km": round(safe_float(route.get("distance")) / 1000, 2),
        "duration_minutes": round(safe_float(route.get("duration")) / 60, 1),
        "geometry": geometry,
    }


def forecast_for_points(points, eta_minutes):
    """Get hourly forecast for several route points in one Open-Meteo request."""
    if not points:
        return []

    latitudes = ",".join(str(point[1]) for point in points)
    longitudes = ",".join(str(point[0]) for point in points)

    params = {
        "latitude": latitudes,
        "longitude": longitudes,
        "hourly": (
            "pm2_5,pm10,nitrogen_dioxide,ammonia,"
            "carbon_monoxide,sulphur_dioxide,ozone"
        ),
        "forecast_hours": 48,
        "timezone": "UTC",
        "timeformat": "unixtime",
    }

    response = requests.get(AIR_QUALITY_URL, params=params, timeout=30)
    response.raise_for_status()
    payload = response.json()
    locations = payload if isinstance(payload, list) else [payload]

    now_ts = datetime.now(timezone.utc).timestamp()
    results = []

    for index, location in enumerate(locations):
        hourly = location.get("hourly", {})
        times = hourly.get("time", [])
        if not times:
            continue

        requested_ts = now_ts + (eta_minutes[index] * 60)
        nearest = min(
            range(len(times)),
            key=lambda i: abs(float(times[i]) - requested_ts),
        )

        def hourly_value(name):
            values = hourly.get(name) or []
            return values[nearest] if nearest < len(values) else None

        raw = {
            "pm2_5": hourly_value("pm2_5"),
            "pm10": hourly_value("pm10"),
            "nitrogen_dioxide": hourly_value("nitrogen_dioxide"),
            "ammonia": hourly_value("ammonia"),
            "carbon_monoxide": hourly_value("carbon_monoxide"),
            "sulphur_dioxide": hourly_value("sulphur_dioxide"),
            "ozone": hourly_value("ozone"),
        }

        pollution = normalize_pollution(raw)
        risk = predict_risk(pollution)
        forecast_time = datetime.fromtimestamp(
            float(times[nearest]), tz=timezone.utc
        ).isoformat()

        results.append({
            "index": index,
            "latitude": points[index][1],
            "longitude": points[index][0],
            "eta_minutes_from_start": eta_minutes[index],
            "forecast_time": forecast_time,
            "pollution": pollution,
            "health_risk": risk,
        })

    return results


# ------------------------------------------------------------
# PAGES
# ------------------------------------------------------------
@app.route("/")
def home():
    return render_template("index.html")


# ------------------------------------------------------------
# CURRENT AIR QUALITY
# ------------------------------------------------------------
@app.route("/air-quality")
def air_quality():
    try:
        latitude = float(request.args.get("lat"))
        longitude = float(request.args.get("lon"))
    except (TypeError, ValueError):
        return jsonify({"error": "Valid latitude and longitude are required."}), 400

    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        return jsonify({"error": "Invalid coordinates."}), 400

    try:
        return jsonify(get_current_air_quality(latitude, longitude))
    except requests.RequestException as exc:
        return jsonify({
            "error": "Unable to retrieve air-quality data.",
            "details": str(exc),
        }), 502
    except Exception as exc:
        return jsonify({
            "error": "Air-quality processing failed.",
            "details": str(exc),
        }), 500


# ------------------------------------------------------------
# SEARCH LOCATION
# ------------------------------------------------------------
@app.route("/search-location")
def search_location():
    query = request.args.get("query", request.args.get("name", "")).strip()

    if not query:
        return jsonify({"error": "Location name is required."}), 400

    try:
        location = geocode_location(query)
        air = get_current_air_quality(
            location["latitude"],
            location["longitude"],
        )

        return jsonify({
            "location_name": location["display_name"],
            "location": location["name"],
            "state": location["state"],
            "country": location["country"],
            "latitude": location["latitude"],
            "longitude": location["longitude"],
            "pollution": air["pollution"],
            "health_risk": air["health_risk"],
            "time": air.get("time"),
        })

    except requests.RequestException as exc:
        return jsonify({
            "error": "Location or air-quality service is unavailable.",
            "details": str(exc),
        }), 502
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 404
    except Exception as exc:
        return jsonify({
            "error": "Location search failed.",
            "details": str(exc),
        }), 500


# ------------------------------------------------------------
# REVERSE LOCATION
# ------------------------------------------------------------
@app.route("/reverse-location")
def reverse_location():
    try:
        latitude = float(request.args.get("lat"))
        longitude = float(request.args.get("lon"))
    except (TypeError, ValueError):
        return jsonify({"error": "Valid latitude and longitude are required."}), 400

    try:
        return jsonify(reverse_geocode(latitude, longitude))
    except requests.RequestException as exc:
        return jsonify({
            "error": "Reverse location service is unavailable.",
            "details": str(exc),
        }), 502
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 404
    except Exception as exc:
        return jsonify({
            "error": "Unable to determine current location.",
            "details": str(exc),
        }), 500


# ------------------------------------------------------------
# ROUTE + ROUTE POLLUTION ANALYSIS
# ------------------------------------------------------------
@app.route("/route-analysis")
def route_analysis():
    try:
        from_lat = float(request.args.get("from_lat"))
        from_lon = float(request.args.get("from_lon"))
        to_lat = float(request.args.get("to_lat"))
        to_lon = float(request.args.get("to_lon"))
    except (TypeError, ValueError):
        return jsonify({
            "error": "Valid starting and destination coordinates are required."
        }), 400

    mode = request.args.get("mode", "car").lower()
    if mode not in MODE_NAMES:
        mode = "car"

    try:
        route = route_geometry(from_lat, from_lon, to_lat, to_lon)
        coordinates = route["geometry"].get("coordinates", [])
        samples = sample_route_coordinates(coordinates, count=7)

        if len(samples) < 2:
            samples = [[from_lon, from_lat], [to_lon, to_lat]]

        # Approximate ETA at each sample by cumulative route distance.
        cumulative = [0.0]
        for i in range(1, len(samples)):
            cumulative.append(
                cumulative[-1] + haversine_km(samples[i - 1], samples[i])
            )

        total_sample_distance = cumulative[-1] or 1.0
        eta_minutes = [
            route["duration_minutes"] * distance / total_sample_distance
            for distance in cumulative
        ]

        forecast_points = forecast_for_points(samples, eta_minutes)

        if not forecast_points:
            raise ValueError("Route forecast data was unavailable.")

        risk_values = [RISK_SCORE.get(item["health_risk"], 1) for item in forecast_points]
        pm25_values = [item["pollution"]["PM2.5"] for item in forecast_points]

        highest_index = max(
            range(len(forecast_points)),
            key=lambda i: risk_values[i],
        )

        high_count = sum(1 for value in risk_values if value >= 3)
        average_pm25 = sum(pm25_values) / len(pm25_values)
        max_pm25 = max(pm25_values)
        overall_risk = max(
            forecast_points,
            key=lambda item: RISK_SCORE.get(item["health_risk"], 1),
        )["health_risk"]

        return jsonify({
            "success": True,
            "mode": mode,
            "travel_mode": MODE_NAMES[mode],
            "distance_km": route["distance_km"],
            "duration_minutes": route["duration_minutes"],
            "duration_text": format_duration(route["duration_minutes"]),
            "geometry": route["geometry"],
            "route_geometry": coordinates,
            "route_type": "Road-network route estimate",
            "overall_risk": overall_risk,
            "average_pm25": round(average_pm25, 2),
            "max_pm25": round(max_pm25, 2),
            "elevated_points": high_count,
            "sample_count": len(forecast_points),
            "highest_risk_point": forecast_points[highest_index],
            "points": forecast_points,
            "note": (
                "Route pollution values are modelled forecasts sampled at selected route points. "
                "They are screening estimates, not direct roadside measurements."
            ),
        })

    except requests.RequestException as exc:
        return jsonify({
            "error": "Route or air-quality service is unavailable.",
            "details": str(exc),
        }), 502
    except Exception as exc:
        return jsonify({
            "error": "Travel analysis failed.",
            "details": str(exc),
        }), 500


@app.route("/route")
def route_compatibility():
    """Compatibility endpoint for older frontend calls."""
    try:
        from_lat = float(request.args.get("from_lat"))
        from_lon = float(request.args.get("from_lon"))
        to_lat = float(request.args.get("to_lat"))
        to_lon = float(request.args.get("to_lon"))
        mode = request.args.get("mode", "car").lower()
        if mode not in MODE_NAMES:
            mode = "car"

        route = route_geometry(from_lat, from_lon, to_lat, to_lon)
        return jsonify({
            "success": True,
            "mode": mode,
            "travel_mode": MODE_NAMES[mode],
            "distance_km": route["distance_km"],
            "duration_minutes": route["duration_minutes"],
            "duration_text": format_duration(route["duration_minutes"]),
            "geometry": route["geometry"],
            "route_geometry": route["geometry"].get("coordinates", []),
            "route_type": "Road-network route estimate",
            "note": "Distance and duration are road-network estimates; actual conditions may vary.",
        })
    except Exception as exc:
        return jsonify({"error": "Route calculation failed.", "details": str(exc)}), 500


# ------------------------------------------------------------
# DESTINATION FORECAST
# ------------------------------------------------------------
def format_duration(minutes):
    minutes = max(0, int(round(minutes)))
    hours, mins = divmod(minutes, 60)
    return f"{hours} hr {mins} min" if hours else f"{mins} min"


@app.route("/forecast")
def forecast():
    try:
        latitude = float(request.args.get("lat"))
        longitude = float(request.args.get("lon"))
    except (TypeError, ValueError):
        return jsonify({"error": "Valid latitude and longitude are required."}), 400

    try:
        result = forecast_for_points([[longitude, latitude]], [60])
        if not result:
            raise ValueError("Forecast data was unavailable.")
        return jsonify(result[0])
    except requests.RequestException as exc:
        return jsonify({"error": "Forecast service is unavailable.", "details": str(exc)}), 502
    except Exception as exc:
        return jsonify({"error": "Forecast failed.", "details": str(exc)}), 500


@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "Requested page or API endpoint was not found."}), 404


if __name__ == "__main__":
    # Render supplies PORT. Local development defaults to 5000.
    import os
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
