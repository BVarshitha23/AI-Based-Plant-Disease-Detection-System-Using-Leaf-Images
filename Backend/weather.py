import httpx
from datetime import date, datetime


#  SOWING DATE HELPERS 
def get_sowing_context(sowing_date_str: str) -> dict:
    if not sowing_date_str:
        return {
            "sowing_date":      "Not provided",
            "days_since_sowing": "Unknown",
            "sowing_note":      "Farmer did not provide sowing date — infer crop stage from season and location.",
        }
    try:
        sowing = datetime.strptime(sowing_date_str, "%Y-%m-%d").date()
        today  = date.today()
        days   = (today - sowing).days
        if days < 0:
            return {
                "sowing_date":       sowing_date_str,
                "days_since_sowing": "Future date — not yet sown",
                "sowing_note":       "Crop has not been sown yet. Provide pre-sowing disease prevention advice.",
            }
        return {
            "sowing_date":       sowing_date_str,
            "days_since_sowing": days,
            "sowing_note":       f"Crop is {days} days old since sowing on {sowing_date_str}.",
        }
    except ValueError:
        return {
            "sowing_date":       sowing_date_str,
            "days_since_sowing": "Invalid date format",
            "sowing_note":       "Sowing date could not be parsed. Infer crop stage from season.",
        }


#  CURRENT DATE CONTEXT 
def get_date_context() -> dict:
    today = date.today()
    return {
        "date":  today.strftime("%d %B %Y"),
        "month": today.strftime("%B"),
        "month_num": today.month,
        "year":  today.year,
    }

def get_season_info(predicted_class: str = "") -> dict:
    ctx = get_date_context()
    return {
        "month":  ctx['month'],
        "date":   ctx['date'],
    }


# REVERSE GEOCODING (Open-Meteo geocoding / Nominatim) 
async def get_location_name(lat: float, lon: float) -> dict:
    try:
        async with httpx.AsyncClient(timeout=6) as client:
            res = await client.get(
                "https://nominatim.openstreetmap.org/reverse",
                params={"lat": lat, "lon": lon, "format": "json"},
                headers={"User-Agent": "LeafSense/1.0"},
            )
            data = res.json()
            addr = data.get("address", {})
            return {
                "display": data.get("display_name", "Unknown location"),
                "city":    addr.get("city") or addr.get("town") or addr.get("village") or "Unknown",
                "state":   addr.get("state", "Unknown"),
                "country": addr.get("country", "Unknown"),
            }
    except Exception:
        return {"display": "Unknown", "city": "Unknown", "state": "Unknown", "country": "Unknown"}


#  WEATHER (Open-Meteo — free, no key needed) 
async def get_weather(lat: float, lon: float) -> dict:
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            res = await client.get(
                "https://api.open-meteo.com/v1/forecast",
                params={
                    "latitude":  lat,
                    "longitude": lon,
                    "current":   "temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,cloud_cover,uv_index",
                    "daily":     "precipitation_sum,temperature_2m_max,temperature_2m_min",
                    "timezone":  "Asia/Kolkata",
                    "forecast_days": 3,
                },
            )
            data = res.json()
            cur  = data.get("current", {})
            daily = data.get("daily", {})

            # Summarise 3-day rain forecast
            rain_3day = daily.get("precipitation_sum", [0, 0, 0])
            total_rain = sum(rain_3day)
            rain_note  = (
                "Heavy rain expected (>15mm) in 3 days"  if total_rain > 15 else
                "Moderate rain expected in 3 days"        if total_rain > 5  else
                "Little to no rain expected in 3 days"
            )

            return {
                "temperature_c":  cur.get("temperature_2m", "N/A"),
                "humidity_pct":   cur.get("relative_humidity_2m", "N/A"),
                "precipitation":  cur.get("precipitation", 0),
                "wind_speed":     cur.get("wind_speed_10m", "N/A"),
                "cloud_cover":    cur.get("cloud_cover", "N/A"),
                "uv_index":       cur.get("uv_index", "N/A"),
                "rain_3day_mm":   round(total_rain, 1),
                "rain_forecast":  rain_note,
                "temp_max_3day":  max(daily.get("temperature_2m_max", [0])),
                "temp_min_3day":  min(daily.get("temperature_2m_min", [0])),
            }
    except Exception:
        return {
            "temperature_c": "N/A", "humidity_pct": "N/A",
            "precipitation": 0,     "wind_speed":   "N/A",
            "cloud_cover":   "N/A", "uv_index":     "N/A",
            "rain_3day_mm":  0,     "rain_forecast": "Forecast unavailable",
            "temp_max_3day": "N/A", "temp_min_3day": "N/A",
        }


#  SOIL (SoilGrids ISRIC — free, no key needed) 
async def get_soil_info(lat: float, lon: float) -> dict:
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            res = await client.get(
                "https://rest.isric.org/soilgrids/v2.0/properties/query",
                params={
                    "lon": lon, "lat": lat,
                    "property": ["phh2o", "nitrogen", "soc"],
                    "depth":    "0-5cm",
                    "value":    "mean",
                },
            )
            data = res.json()
            props = {
                layer["name"]: layer["depths"][0]["values"]["mean"]
                for layer in data.get("properties", {}).get("layers", [])
                if layer.get("depths")
            }
            ph       = round(props.get("phh2o",  0) / 10, 1)  # stored ×10
            nitrogen = props.get("nitrogen", 0)
            soc      = props.get("soc",      0)

            ph_note = (
                "Acidic soil — may limit nutrient uptake"  if ph < 6.0 else
                "Slightly acidic — good for most crops"    if ph < 6.5 else
                "Near-neutral — optimal for most crops"    if ph < 7.5 else
                "Alkaline soil — watch for micronutrient deficiency"
            )
            return {
                "ph":       ph   if ph else "N/A",
                "nitrogen": nitrogen,
                "soc":      soc,
                "ph_note":  ph_note,
            }
    except Exception:
        return {"ph": "N/A", "nitrogen": "N/A", "soc": "N/A", "ph_note": "Soil data unavailable"}


#  BUILD LLAMA PROMPT (fully dynamic — no static season text) 
def build_context_prompt(
    disease_info: dict,
    weather:      dict,
    location:     dict,
    soil:         dict,
    soil_type:    str,
    sowing_ctx:   dict,
    irrigation:   str,
    date_ctx:     dict,
) -> str:
    is_healthy = "healthy" in disease_info["predicted_class"].lower()

    context = f"""You are an expert agronomist AI helping Indian farmers with hyper-local, actionable advice.

=== TODAY'S DATE ===
Date          : {date_ctx['date']}
Month         : {date_ctx['month']}

=== DISEASE DETECTION RESULT ===
Disease       : {disease_info['predicted_class']}
Confidence    : {disease_info['confidence']}%
Severity      : {disease_info['severity_pct']}% leaf infected
Stage         : {disease_info['stage']}
Urgency       : {disease_info['urgency']}

=== FARMER'S LOCATION ===
Region        : {location['city']}, {location['state']}, {location['country']}

=== CURRENT WEATHER (LIVE) ===
Temperature   : {weather['temperature_c']}°C
Humidity      : {weather['humidity_pct']}%
Precipitation : {weather['precipitation']} mm (right now)
Wind Speed    : {weather['wind_speed']} km/h
UV Index      : {weather['uv_index']}
Cloud Cover   : {weather['cloud_cover']}%
3-Day Rain    : {weather['rain_3day_mm']} mm — {weather['rain_forecast']}
Temp Range    : {weather['temp_min_3day']}°C – {weather['temp_max_3day']}°C (next 3 days)

=== SOIL CONDITIONS ===
Soil Type     : {soil_type}
Soil pH       : {soil['ph']}
Nitrogen      : {soil['nitrogen']} cg/kg
Organic Carbon: {soil['soc']} dg/kg

=== CROP SOWING INFORMATION ===
Sowing Date   : {sowing_ctx['sowing_date']}
Days in Field : {sowing_ctx['days_since_sowing']}
Note          : {sowing_ctx['sowing_note']}

=== IRRIGATION METHOD ===
Method        : {irrigation if irrigation and irrigation != 'Unknown' else 'Not specified — assume common method for this region'}

Using all the above real data, reason dynamically about:
- What season/agri-calendar period this is for THIS specific crop in THIS specific region
- What crop growth stage the farmer is likely at (based on days since sowing + month + location)
- How the current live weather will affect disease spread in the NEXT 3 days
- Whether upcoming rain will wash away any treatment applied today
- How the soil pH and type affects fungicide/pesticide effectiveness for this disease
- What is the most critical action given all combined factors
"""

    if is_healthy:
        prompt = context + """
The plant is HEALTHY. Respond ONLY with a valid JSON object (no markdown, no extra text):
{
  "summary": "One friendly sentence praising the farmer, mentioning their location and current weather.",
  "crop_stage": "What growth stage is this crop likely at right now based on sowing date, month and location?",
  "season_assessment": "What season/period is this for this specific crop in this region right now?",
  "weather_impact": "How will the next 3 days of weather affect this healthy plant? Be specific about temperature and rain.",
  "soil_insight": "What does the soil pH and type mean for this crop's nutrient availability and disease resistance?",
  "immediate_actions": ["Action 1 tailored to current weather and crop stage", "Action 2", "Action 3"],
  "prevention_tips": ["Prevention tip 1 relevant to upcoming season/weather", "Tip 2", "Tip 3"],
  "farmer_tip": "One hyper-local practical tip specific to this region, season and irrigation method.",
  "risk_level": "None"
}"""
    else:
        prompt = context + """
Respond ONLY with a valid JSON object (no markdown, no extra text):
{
  "summary": "One urgent sentence: disease name + how current weather in this location makes it worse or better.",
  "crop_stage": "What growth stage is this crop at based on sowing date and current month? How does disease at this stage affect yield?",
  "season_assessment": "What season is this for this crop in this region? Is this disease common now? What makes this timing critical?",
  "weather_impact": "How will temperature, humidity and the rain forecast affect disease spread in next 3 days? Should farmer delay or rush treatment?",
  "soil_impact": "MUST be a plain string. How does the soil pH and type affect: (a) disease severity, (b) fungicide effectiveness, (c) treatment absorption?",
  "immediate_actions": ["Specific action 1 with product name/dosage — account for rain forecast", "Action 2 timed to weather window", "Action 3"],
  "prevention_tips": ["Prevention tip 1 for next season — specific to this soil type", "Tip 2 relevant to irrigation method", "Tip 3"],
  "farmer_tip": "One hyper-local tip: specific chemical/method available in Indian markets for this region and season.",
  "risk_level": "Critical/High/Medium/Low — based on disease severity + weather + crop stage combined"
}
Critical rules: If rain is expected in <24hrs, tell farmer NOT to spray today and give exact alternative timing. Always mention specific Indian fungicide/pesticide brand names. Consider irrigation method when advising water management."""

    return prompt