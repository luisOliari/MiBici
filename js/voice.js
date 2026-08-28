// ---------------------------------------------------------------------------
// Navegacion por voz: usa las instrucciones REALES de giro que devuelve
// OpenRouteService (properties.segments[].steps[]) leidas con la Web Speech
// API (sintesis de voz nativa del navegador, gratis, sin API key).
// ---------------------------------------------------------------------------

// Convierte la respuesta GeoJSON de ORS en una lista simple de pasos con la
// coordenada real (lat/lon) donde corresponde disparar cada indicacion.
function extractRouteSteps(geojson) {
  const feature = geojson.features[0];
  const coords = feature.geometry.coordinates; // [ [lon,lat], ... ]
  const steps = feature.properties.segments.flatMap((seg) => seg.steps);

  return steps.map((step) => {
    const idx = step.way_points[0];
    const [lon, lat] = coords[idx];
    return {
      instruction: step.instruction,
      distanceMeters: step.distance,
      streetName: step.name,
      lat,
      lon,
    };
  });
}

const PREFERRED_VOICE_LANGS = ["es-UY", "es-AR", "es-ES", "es-MX", "es"];

function pickSpanishVoice() {
  if (!("speechSynthesis" in window)) return null;
  const voices = speechSynthesis.getVoices();
  for (const lang of PREFERRED_VOICE_LANGS) {
    const match = voices.find((v) => v.lang.toLowerCase() === lang.toLowerCase());
    if (match) return match;
  }
  return voices.find((v) => v.lang.toLowerCase().startsWith("es")) || null;
}

function speak(text) {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel(); // no acumular indicaciones si llegan muy seguido
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "es-UY";
  const voice = pickSpanishVoice();
  if (voice) utterance.voice = voice;
  utterance.rate = 1;
  speechSynthesis.speak(utterance);
}
