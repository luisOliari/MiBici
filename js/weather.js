// ---------------------------------------------------------------------------
// Clima REAL via Open-Meteo (https://open-meteo.com) — gratis, sin API key,
// sin registro. Uso no comercial permitido hasta ~10.000 llamadas/dia.
// El "veredicto" (apto / con precaucion / no apto) es una heuristica propia
// de este prototipo, NO una recomendacion oficial de ningun organismo.
// ---------------------------------------------------------------------------

const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";
const OPEN_METEO_AIR_QUALITY_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";

const WEATHER_ICONS = {
  clear: "☀️",
  cloudy: "⛅",
  overcast: "☁️",
  fog: "🌫️",
  drizzle: "🌦️",
  rain: "🌧️",
  storm: "⛈️",
  snow: "🌨️",
};

// Mapea el weather_code de Open-Meteo (estandar WMO) a un icono simple.
function weatherCodeToIcon(code) {
  if (code === 0) return WEATHER_ICONS.clear;
  if ([1, 2].includes(code)) return WEATHER_ICONS.cloudy;
  if (code === 3) return WEATHER_ICONS.overcast;
  if ([45, 48].includes(code)) return WEATHER_ICONS.fog;
  if ([51, 53, 55, 56, 57].includes(code)) return WEATHER_ICONS.drizzle;
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return WEATHER_ICONS.rain;
  if ([95, 96, 99].includes(code)) return WEATHER_ICONS.storm;
  if ([71, 73, 75, 77, 85, 86].includes(code)) return WEATHER_ICONS.snow;
  return WEATHER_ICONS.cloudy;
}

async function fetchWeather(lat, lon) {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    current:
      "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m",
    hourly: "precipitation_probability",
    daily: "sunrise,sunset,uv_index_max",
    forecast_days: "1",
    timezone: "auto",
  });
  const res = await fetch(`${OPEN_METEO_URL}?${params.toString()}`);
  if (!res.ok) throw new Error("Open-Meteo error");
  const data = await res.json();

  // Probabilidad de lluvia de la proxima hora (si esta disponible).
  let rainProb = null;
  const hourlyTimes = data.hourly?.time || [];
  const hourlyRainProb = data.hourly?.precipitation_probability || [];
  if (hourlyTimes.length) {
    const nowHourIso = new Date().toISOString().slice(0, 13);
    const idx = hourlyTimes.findIndex((t) => t.startsWith(nowHourIso));
    rainProb = idx >= 0 ? hourlyRainProb[idx] : hourlyRainProb[0];
  }

  const fmtHour = (iso) => (iso ? new Date(iso).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit" }) : null);

  return {
    temperature: data.current.temperature_2m,
    apparentTemperature: data.current.apparent_temperature,
    humidity: data.current.relative_humidity_2m,
    precipitationNow: data.current.precipitation,
    windSpeed: data.current.wind_speed_10m,
    windGusts: data.current.wind_gusts_10m,
    windDirection: data.current.wind_direction_10m,
    weatherCode: data.current.weather_code,
    rainProbability: rainProb,
    sunrise: fmtHour(data.daily?.sunrise?.[0]),
    sunset: fmtHour(data.daily?.sunset?.[0]),
    // Fecha real (no el texto formateado) para poder comparar horarios sin
    // depender del formato 12h/24h que use el navegador para mostrarlo.
    sunsetDate: data.daily?.sunset?.[0] ? new Date(data.daily.sunset[0]) : null,
    uvIndexMax: data.daily?.uv_index_max?.[0] ?? null,
    hourlyTimes,
    hourlyRainProb,
  };
}

// Calidad del aire real (Open-Meteo Air Quality API, gratis, sin key).
// Usamos el indice europeo (EAQI 0-100+: 0-20 buena, 20-40 aceptable, etc.)
async function fetchAirQuality(lat, lon) {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    current: "european_aqi,pm2_5,pm10",
    timezone: "auto",
  });
  const res = await fetch(`${OPEN_METEO_AIR_QUALITY_URL}?${params.toString()}`);
  if (!res.ok) throw new Error("Open-Meteo air quality error");
  const data = await res.json();
  return {
    europeanAqi: data.current?.european_aqi ?? null,
    pm25: data.current?.pm2_5 ?? null,
    pm10: data.current?.pm10 ?? null,
  };
}

function airQualityLabel(aqi) {
  if (aqi == null) return { text: "s/d", level: "ok" };
  if (aqi <= 20) return { text: "Buena", level: "ok" };
  if (aqi <= 40) return { text: "Aceptable", level: "ok" };
  if (aqi <= 60) return { text: "Moderada", level: "warn" };
  if (aqi <= 80) return { text: "Mala", level: "bad" };
  return { text: "Muy mala", level: "bad" };
}

// Rumbo (0-360, 0=Norte) del punto A al punto B.
function bearingDegrees(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// wind_direction_10m de Open-Meteo es de DONDE viene el viento (convencion
// meteorologica). Comparamos contra el rumbo del viaje para saber si empuja
// (a favor), frena (en contra) o pega de costado (lateral).
function classifyWindRelative(windDirectionFrom, travelBearing) {
  const windTowardBearing = (windDirectionFrom + 180) % 360;
  let diff = Math.abs(windTowardBearing - travelBearing) % 360;
  if (diff > 180) diff = 360 - diff;
  if (diff <= 45) return { text: "a favor 💨", level: "ok" };
  if (diff >= 135) return { text: "en contra 🌬️", level: "warn" };
  return { text: "de costado", level: "ok" };
}

// Probabilidad de lluvia MAXIMA (peor caso) durante una ventana de tiempo,
// util para saber si puede llover mientras estas haciendo el viaje.
function getRainProbabilityForWindow(weather, startDate, durationSeconds) {
  const { hourlyTimes, hourlyRainProb } = weather;
  if (!hourlyTimes?.length) return null;

  const endDate = new Date(startDate.getTime() + durationSeconds * 1000);
  let max = null;
  for (let i = 0; i < hourlyTimes.length; i++) {
    const slotStart = new Date(hourlyTimes[i]);
    const slotEnd = new Date(slotStart.getTime() + 60 * 60 * 1000);
    const overlaps = slotStart < endDate && slotEnd > startDate;
    if (overlaps) {
      const prob = hourlyRainProb[i];
      if (max === null || prob > max) max = prob;
    }
  }
  return max ?? weather.rainProbability;
}

// Umbrales propios (heuristica), mas exigentes para monopatin por sus ruedas
// chicas (mas sensibles a piso mojado, pozos y viento lateral).
const VEHICLE_THRESHOLDS = {
  bici: { windBad: 40, windWarn: 25, rainProbBad: 40, rainProbWarn: 30, tempColdWarn: 5, tempHotWarn: 36 },
  monopatin: { windBad: 28, windWarn: 18, rainProbBad: 40, rainProbWarn: 20, tempColdWarn: 8, tempHotWarn: 34 },
};

function computeVerdict(vehicle, w) {
  const t = VEHICLE_THRESHOLDS[vehicle] || VEHICLE_THRESHOLDS.bici;
  const reasons = [];
  let level = "ok";

  const raining = w.precipitationNow > 0.2;
  const rainProb = w.rainProbability ?? 0;

  if (raining || rainProb >= t.rainProbBad || w.windSpeed >= t.windBad) {
    level = "bad";
    if (raining) reasons.push("está lloviendo ahora");
    else if (rainProb >= t.rainProbBad) reasons.push(`${rainProb}% de probabilidad de lluvia`);
    if (w.windSpeed >= t.windBad) reasons.push(`viento fuerte (${Math.round(w.windSpeed)} km/h)`);
  } else if (rainProb >= t.rainProbWarn || w.windSpeed >= t.windWarn || w.temperature <= t.tempColdWarn || w.temperature >= t.tempHotWarn) {
    level = "warn";
    if (rainProb >= t.rainProbWarn) reasons.push(`${rainProb}% de probabilidad de lluvia`);
    if (w.windSpeed >= t.windWarn) reasons.push(`viento moderado (${Math.round(w.windSpeed)} km/h)`);
    if (w.temperature <= t.tempColdWarn) reasons.push("hace bastante frío");
    if (w.temperature >= t.tempHotWarn) reasons.push("mucho calor");
  }

  const labels = {
    ok: "Condiciones buenas para salir",
    warn: `Con precaución: ${reasons.join(", ")}`,
    bad: `No recomendado: ${reasons.join(", ")}`,
  };

  return { level, label: labels[level] };
}
