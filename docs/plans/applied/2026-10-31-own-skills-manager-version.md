---
status: in-progress
type: feature
prs: [16]
issue: 14
---

# agent-kitchen fija la versión mínima de skills-manager

## En simple

**Decisión:** agent-kitchen sube skills-manager a la versión que necesita, en cada repo con skills que prepara, y nunca la baja.

### Hoy: issue-flow decide la versión
issue-flow fija skills-manager aunque no lo usa ([V1](#v1)). agent-kitchen corre lo que diga el repo, aunque le falte lo que necesita ([V2](#v2)).

### Después: apply la sube si falta
Con skills-manager 1.1.0, apply ofrece subirlo a 1.2.0; con 1.3.0 no lo toca ([etapa 1](#etapa-1)). Doctor avisa si queda bajo el mínimo ([etapa 1](#etapa-1)).

### Riesgo: issue-flow todavía lo baja a 1.2.0
Hasta arreglar ramon-sg/issue-flow#22, su upgrade baja 1.3.0 a 1.2.0. Nunca queda bajo el mínimo ([V5](#v5)).

**Fuera:** elegir la versión más nueva por el repo y cambiar cómo se actualiza issue-flow.

## Etapas

| # | Etapa | Estado | PR |
|---|---|---|---|
| 1 | Pieza `skills-manager`: paso en apply, aviso en doctor, spec desde `node_modules` | en curso | [#16](https://github.com/ramon-sg/agent-kitchen/pull/16) |

## Decisiones propias

- **El mínimo es 1.2.0:** es la primera con `--replace`, lo más nuevo que usa agent-kitchen ([V3](#v3)). Con 1.3.0 subiría repos que no lo necesitan. Lo aprobó el usuario.
- **Una pieza nueva, `skills-manager`, primera:** tiene que correr antes que issue-flow, que mueve sus skills con este CLI ([V4](#v4)). Se salta con `--skip skills-manager`. Dentro de la pieza `skills` quedaría después de issue-flow.
- **Solo en repos con `package.json` que usan skills:** aparece si el repo tiene `.agents/skills.json` o si esta corrida no salta `skills`. Un repo de Node sin skills no recibe una dependencia que no usa. Sin `package.json` no se crea uno; en un repo vacío, `issue-flow init` lo agrega en 1.2.0 ([V1](#v1)).
- **Qué versión corre (`skillsManagerSpec`):** si `package.json` fija una exacta, esa, porque es la que deja el `install` del cierre de `apply` ([V6](#v6)). Si no (rango, `workspace:` o falta), la de `node_modules` si está. Si no, el rango, o `1`. El criterio literal de la issue, "`node_modules` si existe", correría la versión vieja justo después de subirla. Con `workspace:`, npx falla hoy ([V7](#v7)).
- **Bajo el mínimo se mide con la versión que correría:** con un rango, la de `node_modules` si está, o el primer `x.y.z` del rango. Sin ninguna de las dos (`*`, `workspace:` sin instalar), no se avisa.
- **Doctor marca `✗` bajo el mínimo,** porque agent-kitchen puede fallar con esa versión. Indica `apply` para una versión exacta y subir el rango para un rango. Sin `package.json` o sin skills, no agrega ninguna línea.
- **Se escribe solo ese valor en `package.json`,** con la sangría que ya usa el archivo y el orden de sus claves. Si falta, va en `devDependencies` en orden alfabético, como hace npm; si ya está en `dependencies`, se sube ahí.
- **agent-kitchen pasa a escribir `package.json`:** el README y `piece.ts` dicen que solo escribe una línea de `AGENTS.md`, y se corrigen.

## Contraste con la realidad

2026-10-31, rama `feat/14-own-skills-manager-version`, commit `b825140`.

| Id | Afirmación | Evidencia | Resultado |
|---|---|---|---|
| <a id="v1"></a>V1 | `issue-flow init` agrega skills-manager en 1.2.0 si falta y conserva la versión si ya está | issue-flow `src/package-edits.ts:72` (`withFlowPackages`, `move=false` desde `init.ts:106`); `package.json:21` de v0.2.6 | ✔ corregida: decía "escribe su propia versión", como el fake (`test/fake-tools.mjs:55`) |
| <a id="v2"></a>V2 | El spec es el texto de `package.json`, o `1` si falta | `src/skills-files.ts:127` | ✔ |
| <a id="v3"></a>V3 | `--replace` llega en 1.2.0; `--candidates` y `--select` en 1.1.0; agent-kitchen no usa `--repo` (1.3.0) | `gh release view v1.2.0 -R ramon-sg/skills-manager`; `src/pieces/skills.ts:149` | ✔ |
| <a id="v4"></a>V4 | Los pasos corren en el orden del arreglo de `statusesOf`, con issue-flow primero, y su upgrade mueve las skills con `skillsManagerSpec` | `src/commands/sync.ts:69` (`PIECES`, en `:37`, solo da los nombres); `src/pieces/issue-flow.ts:64` → `updateSkills` | ✔ corregida: decía "el orden de `PIECES`" |
| <a id="v5"></a>V5 | `issue-flow upgrade` 0.2.6 reescribe skills-manager a 1.2.0; el arreglo no empezó | ramon-sg/issue-flow#22 abierta; PR #27 en draft sin cambios | ✔ corregida: citaba el PR #27 como arreglo |
| <a id="v6"></a>V6 | `apply` termina pidiendo `<pm> install` | `src/commands/sync.ts:246` | ✔ |
| <a id="v7"></a>V7 | npx no acepta `workspace:` | npm 11.11.0: `EUNSUPPORTEDPROTOCOL Unsupported URL Type "workspace:"` | ✔ |

## Detalle para agentes

### <a id="etapa-1"></a>Etapa 1: pieza `skills-manager`

- **Archivos:**
  - `src/pieces/skills-manager.ts` (nueva): `NAME`, `MIN_VERSION = "1.2.0"`, `skillsManagerStatus(root, withSkills)` y `skillsManagerChecks(root)`. El paso declara `downloads: ["@ramon-sg/skills-manager@1.2.0"]`.
  - `src/skills-files.ts`: `skillsManagerSpec` con la regla de arriba.
  - `src/repo.ts`: una función que cambia o agrega una dependencia y conserva la sangría y el orden.
  - `src/commands/sync.ts`: `PIECES` y el arreglo de `statusesOf`, los dos con la pieza primera.
  - `src/commands/doctor.ts`: agrega los checks.
  - `src/piece.ts` (encabezado) y `README.md` (línea 20, tabla de piezas y `doctor`).
  - `docs/agent-guide.md`: filas de `package.json`, de versiones y de skills-manager.
  - `test/fake-tools.mjs`: `init` conserva la versión que ya está y agrega 1.2.0, como el real. `test/helpers.mjs` pasa a 1.2.0, y se actualizan los `@1.1.0` de los tests.
- **Tests, en orden** (`test/skills-manager.test.mjs`, con la CLI de `dist/`):
  1. Con `1.1.0` exacto y skills, `apply --yes` deja `1.2.0` y el paso dice "1.1.0 → 1.2.0". Falla hoy: no hay paso.
  2. En el mismo `apply`, el upgrade de issue-flow mueve sus skills con `@ramon-sg/skills-manager@1.2.0`. Falla si la pieza va después de issue-flow.
  3. Sin skills-manager, lo agrega en `devDependencies` en orden alfabético.
  4. Con `1.10.0`, no hay paso: la comparación es numérica.
  5. Con `1.2.0` exacto y `node_modules` en 1.1.0, el spec es `@1.2.0`.
  6. Con `^1.2.0` y `node_modules` en 1.3.0, el spec es `@1.3.0`. Con `^1.1.0` y `node_modules` en 1.3.0, no hay aviso. Con `^1.1.0` sin `node_modules`, el estado avisa y no hay paso.
  7. Con `workspace:*` y `node_modules` en 1.3.0, el spec es `@1.3.0`.
  8. Una sangría de tabs y el orden de las claves se conservan.
  9. Con `--skip skills` y sin `.agents/skills.json`, la pieza no aparece. Con `--dry-run`, el archivo no cambia.
  10. `doctor` con `1.1.0` da `✗` e indica `apply`. Con `1.3.0`, `ok`.
- **Siguen pasando:** `test/sync.test.mjs` y `test/doctor.test.mjs`, con 1.2.0. Las regex que listan las piezas (`sync.test.mjs:191`, `agents-md.test.mjs:70`) suman `skills-manager`. Los tests de `agents-md.test.mjs` saltan `skills` y no tienen manifiesto, así que no ven la pieza. `doctor.test.mjs:53` sigue contando 4 líneas `·`.
- **Ojo:** el paso relee `package.json` al correr. Las descargas de los pasos de skills se calculan antes, con la versión vieja: se baja una de más, sin romper nada.
- **Hecho cuando:** `npm test` pasa. En un repo temporal con `1.1.0` y skills, `node <worktree>/dist/cli.js apply --dry-run` muestra el paso; `npx agent-kitchen` correría la versión publicada.

## Desvíos

- Etapa 1: `npm test` pasa con 65 tests (11 nuevos en `test/skills-manager.test.mjs`). Si se mueve la pieza detrás de issue-flow, el test 2 falla. En un repo temporal con `1.1.0` y `.agents/skills.json`, `node dist/cli.js apply --dry-run` ofrece "Subir skills-manager 1.1.0 → 1.2.0", y `doctor` lo marca con `✗`. Desvíos:
  - Los tests 5 y 6 del detalle quedaron en un solo test, y 4 y 7 sumaron versiones.
  - El fake de `init` también conserva `github-rest`, como el real.
  - Por `code-audit`: `setDependency` sube la entrada que lee `dependencyVersion` (`devDependencies` primero). Se agregaron tests del orden alfabético con una clave mayor, de `doctor` sin skills y de `--skip skills` con manifiesto; cada uno falla con su mutación.
