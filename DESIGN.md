---
version: 1
name: MiBici
description: Sistema de diseño de MiBici. Adaptado del DESIGN.md "Uber-inspired" de VoltAgent/awesome-design-md (https://github.com/VoltAgent/awesome-design-md) — dúo blanco/negro, píldoras, tarjetas de 16px — con UN solo acento de marca (verde MiBici) reservado para la ruta y el estado "todo bien".

colors:
  ink: "#000000"          # texto principal, botón primario, banner de navegación
  on-ink: "#ffffff"
  body: "#5e5e5e"          # texto secundario
  mute: "#afafaf"          # placeholders, letra chica
  canvas: "#ffffff"
  canvas-soft: "#efefef"   # inputs, chips, botones sutiles
  canvas-softer: "#f6f6f6"
  pressed: "#e2e2e2"
  ink-elevated: "#282828"  # fondo de tarjetas dentro del banner negro
  route: "#16a34a"         # ÚNICO acento: línea de ruta, "ideal para salir"
  route-casing: "#0b5d2a"  # borde oscuro de la línea de ruta
  route-done: "#9ca3af"    # tramo ya recorrido
  user: "#1a73e8"          # punto "vos estás acá"
  destination: "#000000"   # pin de destino
  warn: "#b45309"
  danger: "#c62828"

typography:
  family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif
  display-lg: { size: 28px, weight: 700, line: 34px }   # instrucción de giro en navegación
  display-md: { size: 22px, weight: 700, line: 28px }   # temperatura, títulos de tarjeta
  display-sm: { size: 18px, weight: 700, line: 24px }
  body-lg:    { size: 16px, weight: 500, line: 22px }   # inputs, botones
  body-md:    { size: 15px, weight: 400, line: 22px }
  body-sm:    { size: 13px, weight: 400, line: 18px }
  caption:    { size: 11px, weight: 500, line: 16px }

rounded:
  md: 8px      # inputs
  lg: 12px
  xl: 16px     # tarjetas, bottom sheet
  pill: 999px  # TODO elemento interactivo

spacing: { xxs: 4px, xs: 6px, sm: 8px, md: 12px, lg: 16px, xl: 20px, 2xl: 24px }

elevation:
  flat: none
  float: "0 2px 8px rgba(0,0,0,.16)"    # píldoras flotando sobre el mapa
  sheet: "0 -4px 16px rgba(0,0,0,.16)"  # bottom sheet
---

## Principios

1. **El mapa manda.** La app es un mapa a pantalla completa con controles flotando encima. Todo lo demás (clima, formulario, resultados) vive en un bottom sheet que se puede achicar.
2. **Blanco y negro + un solo acento.** El negro es la acción principal (un botón negro por pantalla). El verde se usa SOLO para la ruta y para "condiciones ideales". No agregar azules, violetas ni amarillos decorativos; los colores de advertencia (`warn`, `danger`) se usan solo para advertir.
3. **La píldora es la forma.** Botones, chips, toggles y badges flotantes van con `rounded.pill`. Tarjetas y sheet con `rounded.xl`. Inputs con `rounded.md`.
4. **Legible andando.** En navegación la instrucción va enorme (`display-lg`), en blanco sobre negro, arriba de todo, con una flecha de maniobra. Nada de texto de menos de 13px en pantallas de uso en movimiento.
5. **Frases, no mayúsculas.** Títulos en oración ("Calcular ruta"), nunca TODO EN MAYÚSCULAS salvo etiquetas mínimas de datos (`caption`).

## Componentes

- **`search-pill`** — el "¿A dónde vas?" del sheet: fila `canvas-soft`, `rounded.md`, icono + input, 48px de alto mínimo.
- **`mode-toggle`** — "Dirección / Esquina": segmented control `canvas-soft` con la opción activa en `ink` + `on-ink`, `rounded.pill`.
- **`button-primary`** — negro, texto blanco, `body-lg` 600, `rounded.pill`, 52px de alto. Uno por vista.
- **`button-secondary`** — `canvas-soft`, texto `ink`, `rounded.pill`.
- **`floating-pill`** — blanco, sombra `float`, `rounded.pill`, sobre el mapa (ciclovías, GPS, ubicarme).
- **`nav-banner`** — negro arriba de la pantalla en navegación: flecha 44px + distancia `display-md` + instrucción `display-lg` + calle `body-md` gris claro. Debajo, una segunda línea "Después: …" en `ink-elevated`.
- **`nav-footer`** — blanco abajo en navegación: llegada · minutos · km restantes + botón "Salir" `button-secondary`.
- **`route-line`** — doble trazo tipo Waze: borde `route-casing` 10px + línea `route` 6px; lo ya recorrido pasa a `route-done`. Flechitas/puntos blancos en cada giro.
- **`step-list`** — lista del trayecto planificado: icono de maniobra + "Doblá a la derecha en Av. Italia" + distancia, separadores de 1px `canvas-soft`.

## No hacer
- No usar sombras en todas las tarjetas: solo sheet y píldoras flotantes.
- No meter un segundo acento de color.
- No achicar los targets táctiles por debajo de 44px.
