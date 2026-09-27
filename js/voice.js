// ---------------------------------------------------------------------------
// Navegacion por voz: usa las instrucciones REALES de giro que devuelve
// OpenRouteService (properties.segments[].steps[]) leidas con la Web Speech
// API (sintesis de voz nativa del navegador, gratis, sin API key).
// ---------------------------------------------------------------------------

// Tipos de maniobra de ORS -> flecha para mostrar y verbo corto para la voz.
const MANEUVERS = {
  0: { arrow: "↰", verb: "doblá a la izquierda" },
  1: { arrow: "↱", verb: "doblá a la derecha" },
  2: { arrow: "↰", verb: "doblá bien a la izquierda" },
  3: { arrow: "↱", verb: "doblá bien a la derecha" },
  4: { arrow: "↖", verb: "tomá levemente a la izquierda" },
  5: { arrow: "↗", verb: "tomá levemente a la derecha" },
  6: { arrow: "↑", verb: "seguí derecho" },
  7: { arrow: "⟳", verb: "entrá a la rotonda" },
  8: { arrow: "⟳", verb: "salí de la rotonda" },
  9: { arrow: "⤺", verb: "pegá la vuelta en U" },
  10: { arrow: "⚑", verb: "llegaste a tu destino" },
  11: { arrow: "↑", verb: "arrancá" },
  12: { arrow: "↖", verb: "mantenete a la izquierda" },
  13: { arrow: "↗", verb: "mantenete a la derecha" },
};

function maneuverOf(step) {
  return MANEUVERS[step?.type] || { arrow: "↑", verb: "seguí" };
}

// ORS pone "-" cuando el tramo no tiene nombre.
function cleanStreetName(name) {
  return name && name !== "-" ? name : "";
}

// Convierte una ruta (feature GeoJSON de ORS) en una lista simple de pasos con la
// coordenada real (lat/lon) donde corresponde disparar cada indicacion.
function extractRouteSteps(feature) {
  const coords = feature.geometry.coordinates; // [ [lon,lat], ... ]
  const steps = feature.properties.segments.flatMap((seg) => seg.steps);

  return steps.map((step) => {
    const idx = step.way_points[0];
    const [lon, lat] = coords[idx];
    return {
      instruction: step.instruction,
      type: step.type,
      exitNumber: step.exit_number,
      distanceMeters: step.distance, // largo del tramo que EMPIEZA con esta maniobra
      streetName: cleanStreetName(step.name),
      vertexIndex: idx,
      lat,
      lon,
    };
  });
}

// Frase corta y natural para decir en voz alta ("doblá a la derecha en Av. Italia").
function spokenManeuver(step) {
  if (!step) return "";
  if (step.type === 10) return "llegaste a tu destino";
  if (step.type === 7 && step.exitNumber) {
    return `en la rotonda, tomá la ${ordinal(step.exitNumber)} salida${step.streetName ? `, hacia ${step.streetName}` : ""}`;
  }
  const m = maneuverOf(step);
  return step.streetName ? `${m.verb} en ${step.streetName}` : m.verb;
}

function ordinal(n) {
  return ["primera", "segunda", "tercera", "cuarta", "quinta", "sexta"][n - 1] || `${n}ª`;
}

// "350 metros", "1,2 kilómetros" — redondeado como lo diria una persona.
function spokenDistance(m) {
  if (m >= 950) {
    const km = Math.round(m / 100) / 10;
    return `${String(km).replace(".", ",")} ${km === 1 ? "kilómetro" : "kilómetros"}`;
  }
  if (m >= 100) return `${Math.round(m / 50) * 50} metros`;
  return `${Math.max(10, Math.round(m / 10) * 10)} metros`;
}

const PREFERRED_VOICE_LANGS = ["es-UY", "es-AR", "es-ES", "es-MX", "es-US", "es"];

function pickSpanishVoice() {
  if (!("speechSynthesis" in window)) return null;
  const voices = speechSynthesis.getVoices();
  for (const lang of PREFERRED_VOICE_LANGS) {
    const match = voices.find((v) => v.lang.toLowerCase().replace("_", "-") === lang.toLowerCase());
    if (match) return match;
  }
  return voices.find((v) => v.lang.toLowerCase().startsWith("es")) || null;
}

const voiceState = { muted: false, lastSpokeAt: 0 };

// priority "high" corta lo que se este diciendo (un giro inminente no puede
// esperar); "low" se descarta si ya esta hablando (recordatorios periodicos).
function speak(text, priority = "normal") {
  if (!text || voiceState.muted || !("speechSynthesis" in window)) return;
  if (priority === "low" && speechSynthesis.speaking) return;
  if (priority === "high") speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "es-UY";
  const voice = pickSpanishVoice();
  if (voice) utterance.voice = voice;
  utterance.rate = 1.02;
  speechSynthesis.speak(utterance);
  voiceState.lastSpokeAt = Date.now();
}

// iOS/Safari solo habilita la voz si el primer speak() sale de un toque del
// usuario: lo llamamos desde el boton "Iniciar" con un texto vacio.
function unlockSpeech() {
  if (!("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(" ");
  u.volume = 0;
  speechSynthesis.speak(u);
}
