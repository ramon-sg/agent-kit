# Guía del sistema de agentes

Esta guía explica, en simple, las herramientas que `agent-kitchen` instala en un repo, cada skill y cómo se usan juntas. El detalle para agentes (archivos, comandos, reglas) está en [agents.md](agents.md).

## Resumen

- **Un comando lo instala todo:** `npx agent-kitchen` muestra qué tiene el repo, qué falta y qué está atrasado, y lo deja al día.
- **Cada issue tiene su rama, su carpeta y su PR:** `issue-flow` los crea al empezar y los borra cuando se mergea.
- **Las skills le enseñan al agente cada paso:** crear una issue, empezarla, planificar, auditar, responder la revisión y mergear.
- **Las barandas dejan trabajar al agente sin preguntar:** `claude-repo-guard` le permite escribir solo dentro de su carpeta.
- **Lo mismo funciona en la nube:** `claude-cloud` prepara las sesiones de Claude en claude.ai con las herramientas del repo.

## Las herramientas

| Herramienta | Qué hace | Repo |
|---|---|---|
| `agent-kitchen` | Instala, actualiza y revisa todas las demás | [ramon-sg/agent-kitchen](https://github.com/ramon-sg/agent-kitchen) |
| `issue-flow` | Rama, carpeta propia (worktree), Docker y PR en draft por cada issue | [ramon-sg/issue-flow](https://github.com/ramon-sg/issue-flow) |
| `skills-manager` | Copia las skills al repo y fija su versión | [ramon-sg/skills-manager](https://github.com/ramon-sg/skills-manager) |
| `agent-skills` | Catálogo de skills generales: planes, explicaciones y auditorías | [ramon-sg/agent-skills](https://github.com/ramon-sg/agent-skills) |
| `claude-repo-guard` | Barandas: el agente no pide permiso y no sale de su carpeta | [ramon-sg/claude-repo-guard](https://github.com/ramon-sg/claude-repo-guard) |
| `claude-cloud` | Prepara las sesiones de Claude en la nube | [ramon-sg/claude-cloud](https://github.com/ramon-sg/claude-cloud) |
| `github-rest` | Habla con GitHub sin GraphQL, que la nube bloquea | [ramon-sg/github-rest](https://github.com/ramon-sg/github-rest) |

## Las skills: qué hace cada una

Una skill es un instructivo que el agente lee cuando le toca ese trabajo. Se piden con `/nombre` (por ejemplo `/start-issue 42`), o el agente la elige sola cuando el pedido calza con ella.

### Del flujo de issues (vienen con `issue-flow`)

| Skill | Qué hace | Cuándo se usa |
|---|---|---|
| `github-issues` | Escribe una issue corta, con criterios comprobables, labels y el nombre de su rama. Muestra el borrador y la crea solo con tu OK | Al pedir una issue, o cuando aparece algo que no se arregla ahora |
| `start-issue` | Crea o retoma la rama de la issue en su carpeta, abre el PR en draft y te asigna la issue | Al empezar una issue desde una sesión |
| `close-pr` | Audita, deja al día el plan y los documentos, saca el PR de draft, espera la revisión y CI, y mergea | Cuando el trabajo está listo para cerrar |
| `pr-review-comments` | Lee los comentarios de bots y personas y los checks de CI, verifica cada uno, propone qué arreglar y responde | Después de un push, cuando llega la revisión |
| `pr-worktree` | Abre el PR de otra persona en su propia carpeta, sin tocar lo que estás haciendo | Al revisar un PR ajeno |

### Generales (catálogo `agent-skills`)

| Skill | Qué hace | Cuándo se usa |
|---|---|---|
| `planning` | Escribe un plan corto: una parte para personas que se lee en un minuto, etapas y la evidencia de cada afirmación | Una feature, un refactor o un bug cuya causa no es obvia |
| `narrative-summary` | Explica algo en lenguaje llano, con lo importante primero | Al escribir la parte "En simple" de un plan o una issue, o cuando algo no se entiende |
| `visual-preview` | Abre una pestaña del navegador con mockups que puedes elegir con un clic | Cuando una decisión se entiende mejor viéndola (pantallas, flujos, dos diseños) |
| `code-audit` | Revisa el cambio buscando lo que rompe: bugs, seguridad, contratos y tests que faltan. Termina con un veredicto | Antes de pedir revisión del PR |
| `test-audit` | Revisa si los tests prueban lo que dicen, rompiendo el código a propósito para ver si fallan | Al revisar tests, o una carpeta entera con `--suite` |

### De `skills-manager`

| Skill | Qué hace | Cuándo se usa |
|---|---|---|
| `manage-skills` | Lista, agrega y actualiza las skills del repo con los comandos de `skills-manager` | Al preguntar qué skills hay, o al agregar o actualizar una |

Algunas skills llaman a otras: `planning` usa `narrative-summary` y `visual-preview`; `code-audit` usa `test-audit`; `close-pr` usa `code-audit` y `pr-review-comments`; `pr-review-comments` usa `github-issues`. Por eso se instalan juntas.

## Dónde están las skills

- **En tu repo:** en `.agents/skills/<nombre>/`. `skills-manager` las copia ahí y se commitean, así llegan a cada carpeta de trabajo y a la nube sin descargar nada.
- **Su origen:** las del flujo, en [`issue-flow/skills/`](https://github.com/ramon-sg/issue-flow/tree/main/skills); las generales, en [`agent-skills/skills/`](https://github.com/ramon-sg/agent-skills/tree/main/skills); `manage-skills`, en [`skills-manager/skills/`](https://github.com/ramon-sg/skills-manager/tree/main/skills).
- **Qué versión tiene el repo:** `.agents/skills.lock.json` guarda la versión exacta de cada una. `.agents/skills.json` dice cuáles quieres.
- **Lo propio de tu repo:** varias skills traen un `project.md` en su carpeta (la rama base, el comando de tests, los labels). Ese archivo es tuyo y se edita a mano; lo demás de la skill no se toca, porque una actualización lo reemplaza.

Para cambiar una skill para todos los repos, se cambia en su repo de origen y se publica una versión nueva. Para cambiarla solo en un repo, se edita su `project.md`.

## Un día con el flujo

1. **Anotar el trabajo:** le pides al agente una issue y `github-issues` la escribe; tú la apruebas.
2. **Empezar:** `npx @ramon-sg/issue-flow issue start 42` crea la carpeta de la issue, abre el PR en draft y abre Claude ahí.
3. **Planificar, si hace falta:** con un cambio grande, `planning` escribe el plan y espera tu OK antes de tocar código.
4. **Implementar:** el agente escribe primero el test que falla y después el arreglo.
5. **Cerrar:** `close-pr` corre `code-audit`, saca el PR de draft y espera la revisión. `pr-review-comments` atiende cada comentario.
6. **Mergear y limpiar:** con un review aprobado y CI en verde, `close-pr` mergea. `issue-flow worktree prune` borra la carpeta, su Docker y sus puertos.

El agente nunca hace commit, push, merge ni crea una issue sin tu OK explícito.
