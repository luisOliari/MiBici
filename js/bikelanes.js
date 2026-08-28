// ---------------------------------------------------------------------------
// Capa de ciclovias reales (OpenStreetMap / Overpass) sobre el mapa actual.
// Se pide bajo demanda (boton), en base al area que se esta viendo, para no
// sobrecargar Overpass con consultas de toda la ciudad.
// ---------------------------------------------------------------------------

function overpassBboxFromLeafletBounds(bounds) {
  // Overpass usa (south,west,north,east)
  return `${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()}`;
}

async function fetchCycleways(bounds) {
  const bbox = overpassBboxFromLeafletBounds(bounds);
  const query = `[out:json][timeout:25];way["highway"="cycleway"](${bbox});out geom;`;
  const data = await queryOverpass(query);
  return data.elements.filter((w) => w.geometry?.length > 1);
}
