---
status: applied
type: feature
prs: [8]
issue: 7
---

# Una línea en AGENTS.md para que el agente use la versión instalada

## En simple

**Decisión:** agent-kitchen agregará a AGENTS.md una línea que pide revisar la versión instalada de cada biblioteca antes de usarla.

### Hoy: el agente escribe de memoria
Sin la línea, el agente revisó la versión pero no leyó los tipos de la biblioteca ([V1](#v1)).

### Después: lee los tipos instalados
Con la línea, leyó los tipos antes de escribir ([V1](#v1)). agent-kitchen la agrega y doctor avisa si falta ([etapa 1](#etapa-1)).

### Riesgo: la guía de agentes se carga sola
En macOS, Claude Code toma la guía de agentes de este repo como instrucciones ([V4](#v4)). Se renombra ([etapa 2](#etapa-2)).

**Fuera:** tablas de versiones y proyectos sin package.json.

## Etapas

| # | Etapa | Estado | PR |
|---|---|---|---|
| 1 | La línea en AGENTS.md y su aviso en doctor | implementada | [#8](https://github.com/ramon-sg/agent-kitchen/pull/8) |
| 2 | Las guías: nombre nuevo, la pieza y por qué AGENTS.md es mínimo | implementada | [#8](https://github.com/ramon-sg/agent-kitchen/pull/8) |

## Decisiones propias

- **Una pieza nueva, `agents-md`, al final de `PIECES`:** la línea no depende de ninguna skill, y se deja fuera con `--skip agents-md` ([V5](#v5)). Es la primera pieza sin herramienta propia: agent-kitchen escribe la línea, como ya escribe las opciones del guard. Los textos que dicen que cada pieza la instala su herramienta se ajustan.
- **Espera el estado del flujo, como el guard:** en un repo vacío, `package.json` lo crea `issue-flow init` en la misma corrida ([V6](#v6)). Se ofrece si hay `package.json` o si el flujo se va a instalar; al correr, si sigue sin `package.json`, anota y no escribe nada.
- **Sin `package.json` y sin flujo por instalar, la pieza no aparece** en "Este repo tiene": `statusesOf` ya filtra los `null`.
- **Se busca la línea exacta, sin marcadores:** dos líneas de marcadores costarían más que la propia línea. Si alguien la retoca, se agrega otra vez; es lo que costaría si está mal.
- **`@AGENTS.md` solo si ya hay `CLAUDE.md`:** con `CLAUDE.md`, Claude Code no lee `AGENTS.md` ([V3](#v3)); sin `CLAUDE.md`, sí ([V2](#v2)). Va al final de `CLAUDE.md`, sin tocar lo demás.
- **La guía pasa a `docs/agent-guide.md`,** un nombre que no choca con `AGENTS.md` en ningún disco.
- **El `AGENTS.md` de agent-kitchen suma la línea:** el repo tiene `package.json`, y su propio doctor la pediría.

## Contraste con la realidad

Comprobado el 2026-10-30 sobre `feat/7-installed-version-docs` en `371657c`, con Claude Code 2.1.314. Un subagente revisó el plan anterior; de ahí salen V3, V6 y los ajustes del detalle.

| Id | Afirmación | Evidencia | Resultado |
|---|---|---|---|
| <a id="v1"></a>V1 | Con la línea, el agente lee los tipos de la biblioteca antes de escribir; sin ella, no. En los dos casos revisa la versión y compila | 8 corridas de `claude -p` (Opus 5.5) en el scratchpad, con Zod 3.23.8 y Zod 4.1.5: las 4 con la línea hicieron `grep` en los `.d.ts` de Zod; las 8 leyeron la versión y pasaron `tsc` | ✔ |
| <a id="v2"></a>V2 | Sin `CLAUDE.md`, Claude Code lee `AGENTS.md` | `claude -p` en una carpeta con solo `AGENTS.md` respondió su palabra clave sin leer archivos | ✔ corregida: un plan anterior decía que siempre hacía falta `@AGENTS.md` |
| <a id="v3"></a>V3 | Con `CLAUDE.md`, Claude Code no lee `AGENTS.md` | La misma prueba con `AGENTS.md` y `CLAUDE.md`: respondió solo la palabra de `CLAUDE.md` y dijo que `AGENTS.md` "no se cargó" | ✔ |
| <a id="v4"></a>V4 | En macOS, `docs/agents.md` se carga como un `AGENTS.md` anidado | En esta sesión, leer un archivo de `docs/` inyectó "Contents of …/docs/AGENTS.md" con el texto de `docs/agents.md` | ✔ |
| <a id="v5"></a>V5 | Una pieza es un archivo en `src/pieces/` con `<pieza>Status` y `<pieza>Checks`, registrado en `PIECES`, en `statusesOf` y en doctor | `README.md:61`; `src/commands/sync.ts:34` y `:63`; `src/commands/doctor.ts:28` | ✔ |
| <a id="v6"></a>V6 | Los estados se calculan antes de correr pasos, y el guard ya espera el estado del flujo | `src/commands/sync.ts:62` y `:215-217` | ✔ |

## Detalle para agentes

### <a id="etapa-1"></a>Etapa 1: La línea en AGENTS.md y su aviso en doctor

- **Archivos:** `src/pieces/agents-md.ts` (`NAME = "agents-md"`, `VERSION_RULE` con el texto exacto de la issue, `agentsMdStatus(root, flowComing)`, `agentsMdChecks(root)`), `src/commands/sync.ts` (`PIECES`, `statusesOf` y el encabezado), `src/commands/doctor.ts` (registro y encabezado), `src/piece.ts` (encabezado), `AGENTS.md` de la raíz (la línea), `test/helpers.mjs` (`installedRepo` escribe `AGENTS.md` con la línea), `test/sync.test.mjs`, `test/doctor.test.mjs`.
- **Qué escribe el paso:** sin `AGENTS.md`, lo crea con la línea y un salto final; con `AGENTS.md`, agrega al final una línea en blanco y la línea. Si hay `CLAUDE.md` sin `@AGENTS.md`, le agrega `@AGENTS.md` al final. La etiqueta nombra los archivos que toca.
- **Tests, en orden** (con `--skip issue-flow,claude-cloud,claude-repo-guard,skills` salvo el 4):
  1. Con `package.json` y sin `AGENTS.md`, `--dry-run` muestra `[x] Agregar a AGENTS.md la regla de versiones instaladas`.
  2. Con `--yes`, `AGENTS.md` queda igual a `VERSION_RULE + "\n"`, y no se crea `CLAUDE.md`.
  3. Con un `AGENTS.md` y un `CLAUDE.md` propios, los dos conservan su contenido; `AGENTS.md` termina con la línea y `CLAUDE.md` con `@AGENTS.md`.
  4. En un repo vacío, con `--yes`, el paso se ofrece y escribe la línea en la misma corrida que instala el flujo.
  5. `--skip agents-md` la deja fuera, y `--skip` sigue rechazando una pieza desconocida.
  6. `doctor.test.mjs`: sin la línea, `· agents-md: falta la regla de versiones en AGENTS.md; corre npx agent-kitchen`; con `CLAUDE.md` sin `@AGENTS.md`, `· agents-md: CLAUDE.md no importa AGENTS.md`; con todo, `✓`. Doctor sale con 0.
- **Guardas** (ya pasan hoy): con la línea, no hay paso; sin `package.json` ni flujo por instalar, ni paso, ni fila, ni línea en doctor.
- **Siguen pasando:** todo `sync.test.mjs` y `doctor.test.mjs`. "--dry-run on an empty repo shows the four pieces…" y "--skip leaves pieces out…" siguen en verde: el primero busca líneas sueltas, y el regex del segundo no está anclado.
- **Ojo:** sin la línea en `installedRepo`, fallarían "a repo at the latest of everything has nothing to do…" (`sync.test.mjs:90`) y el que espera ningún ✓ (`sync.test.mjs:202`).
- **Hecho cuando:** `npm test` pasa.

### <a id="etapa-2"></a>Etapa 2: Las guías: nombre nuevo, la pieza y por qué AGENTS.md es mínimo

- **Archivos:** `git mv docs/agents.md docs/agent-guide.md`. Enlaces en `AGENTS.md:3`, `README.md:10` y `docs/README.md:3` (relativo). `docs/README.md`: la pieza en "Las herramientas" y un párrafo corto de por qué `AGENTS.md` es mínimo y por qué la regla y no una tabla. `docs/agent-guide.md`: `AGENTS.md` y `CLAUDE.md` en "Mapa de archivos". `README.md`: la pieza en "En simple" y una fila en "Las piezas" con "—" en las columnas de versión. `package.json`: la `description` nombra la pieza.
- **Tests:** no hay. `rg -n 'agents\.md' --glob '!docs/plans/**'` solo encuentra `AGENTS.md` en mayúsculas; `rg -n 'agents-md' docs/ README.md` encuentra la pieza.
- **Hecho cuando:** nada apunta al nombre viejo, las guías nombran la pieza y explican por qué `AGENTS.md` es mínimo.

## Desvíos

- **Etapa 1:** los tests nuevos van en `test/agents-md.test.mjs`, no repartidos en `sync.test.mjs` y `doctor.test.mjs`: prueban una sola pieza. `RULE` vive en `test/helpers.mjs` como literal, para que `installedRepo` la use. Una mutación (`agentsMdStatus(root, false)`) hizo fallar el test del repo vacío; restaurado con `cp` y `cmp`. `npm test`: 45 pasan, 0 fallan.
- **Auditoría (`code-audit`, veredicto `changes`: 2 MAYOR, 3 MENOR):** un `CLAUDE.md` enlazado a `AGENTS.md` ya no recibe `@AGENTS.md` (`realpathSync`); el paso respeta el fin de línea del archivo (CRLF) y solo recorta saltos finales; tests nuevos para el enlace, CRLF, archivos vacíos o sin salto final, la segunda corrida y la corrida que termina sin `package.json`. `npm test`: 48 pasan. Lo NO VERIFICABLE (cómo carga Claude Code un `AGENTS.md` que se importa a sí mismo) deja de importar: ya no se escribe.
- **Etapa 2:** `docs/README.md` explica por qué `AGENTS.md` es mínimo en una sección propia, "AGENTS.md: una línea, no un manual". `README.md` también anota la pieza en el párrafo de `doctor`.
- **Cierre:** mergeado en #8 (`97e3a8f`). CI en verde en Ubuntu y macOS con Node 20 y 24; `npm test`: 48 pasan, 0 fallan.
