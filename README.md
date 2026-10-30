# agent-kitchen

Un solo comando para instalar, actualizar y revisar lo que un repo usa para trabajar con agentes: el flujo de issues con sus skills, las skills generales, las sesiones de Claude en la nube y las barandas de seguridad.

```sh
npx agent-kitchen          # muestra qué hay, qué falta y qué está atrasado, y pregunta
npx agent-kitchen doctor   # revisa que todo funcione, sin cambiar nada
```

Qué hace cada herramienta y cada skill, y dónde están: [docs/README.md](docs/README.md) para personas y [docs/agent-guide.md](docs/agent-guide.md) para agentes.

Al arrancar revisa si npm tiene una versión más nueva de sí mismo. Si la hay, corre esa con los mismos argumentos, así que `npx` nunca usa una copia vieja de su caché.

## En simple

- Muestra cada pieza con la versión que tiene el repo y si está al día.
- Pregunta una vez: **todo lo sugerido** (Enter), **elegir** los pasos y las skills, o **salir**. Todas las preguntas van antes de instalar; después corre solo.
- Cada paso es una línea con ✓ o ✗. La salida de cada herramienta solo aparece si falla, o con `--verbose`.
- Es rápido: las versiones se consultan todas a la vez y las herramientas se descargan mientras respondes.
- Cada pieza la instala su propia herramienta. `agent-kitchen` solo sabe cuáles hay, en qué versión están y cómo se conectan entre sí. La excepción es una línea de `AGENTS.md`, que escribe él mismo.
- Correrlo de nuevo no rompe nada: si todo está al día, lo dice y termina.

## Las piezas

| Pieza | Qué es | Versión del repo | Última | Instalar | Actualizar |
|---|---|---|---|---|---|
| `issue-flow` | Flujo de issues ([`@ramon-sg/issue-flow`](https://github.com/ramon-sg/issue-flow)): rama, worktree y PR en draft por issue, y sus 5 skills | `package.json` | npm | `issue-flow init` | `issue-flow upgrade` en la versión nueva, y sus skills a la misma tag |
| `claude-cloud` | Sesiones en la nube ([`@ramon-sg/claude-cloud`](https://github.com/ramon-sg/claude-cloud)): herramientas, Docker y el clone completo | `.claude/cloud.json` | npm | `claude-cloud init` | Cambia la versión que fija `.claude/cloud.json` |
| `claude-repo-guard` | Barandas ([`claude-repo-guard`](https://github.com/ramon-sg/claude-repo-guard)): modo auto con sandbox, escribe solo en su worktree | `.claude/repo-guard.manifest.json` | Tags `vX.Y.Z` de GitHub | `apply` en esa tag (`install` antes de 0.5.0) | `apply` en la tag nueva |
| `skills` | Skills con [`skills-manager`](https://github.com/ramon-sg/skills-manager): las del flujo y las de [`agent-skills`](https://github.com/ramon-sg/agent-skills) (planes, auditoría de código y de tests) | `.agents/skills.lock.json` | Tags del catálogo | `skills-manager init --select` con las elegidas | `skills-manager update` |
| `agents-md` | Una línea en `AGENTS.md` que le pide al agente mirar la versión instalada de una biblioteca antes de usarla. Si el repo tiene `CLAUDE.md`, le agrega `@AGENTS.md`, porque si no Claude Code no lee `AGENTS.md`. Solo en repos con `package.json` | `AGENTS.md` | — | La escribe `agent-kitchen` | — |

Si npm o GitHub no responden, la pieza se muestra pero no se ofrece actualizarla. Si un paso falla, los demás siguen y el comando dice cómo reintentarlo.

### Cómo se conectan

- **Las skills del flujo van con su CLI,** porque la llaman: se instalan en la tag de la versión del flujo y se mueven con él. Las generales llevan cada una su propia versión.
- **Qué skills:** la primera vez vienen todas las de los catálogos. Con "Elegir" aparece un menú agrupado por catálogo, con la descripción de cada una. Si un catálogo trae skills que el repo no tiene, se ofrecen como un paso sin marcar.
- **Skills propias del repo:** si el repo ya tiene una carpeta con el nombre de una skill del catálogo, pregunta una vez si reemplazarlas. Al reemplazar se conserva su `project.md`. Con `--yes` no se reemplazan: se dejan fuera y lo dice.
- **Seguridad y flujo:** si el repo tiene el flujo, antes de instalar `claude-repo-guard` se escribe en sus opciones que abrir el PR en draft, asignar la issue y agregar el "Slug de rama" son parte del trabajo normal. También se escribe la rama base del flujo como `integrationBranch`. En macOS se agrega `weakerNetworkIsolation`, que `gh` necesita dentro del sandbox. Si `claude-repo-guard` ya estaba al día pero le faltan esas opciones, se ofrecen como un paso.
- **La nube no molesta en local:** el hook de sesión solo actúa en la nube. Un repo que nunca se abre ahí no pierde nada.

## Uso

```sh
npx agent-kitchen                        # pregunta, en una terminal (Enter: todo lo sugerido)
npx agent-kitchen --dry-run              # solo muestra qué haría
npx agent-kitchen --yes                  # hace lo sugerido sin preguntar
npx agent-kitchen --verbose              # muestra la salida de cada herramienta
npx agent-kitchen --skip claude-cloud    # deja fuera una pieza (o varias, con comas)
npx agent-kitchen doctor                 # revisa cada pieza con su propio doctor
```

- **Sin terminal y sin `--yes`** (por ejemplo, desde un agente), solo muestra lo que ofrecería.
- **Corre en el checkout principal,** no en un worktree, y desde tu terminal. Dentro de una sesión de Claude, el sandbox de `claude-repo-guard` no deja escribir `.claude/settings.json`.
- **Al terminar,** corre el `install` de tu gestor de paquetes, revisa el diff y haz commit.

**`doctor`** corre el doctor de cada herramienta en la versión del repo: `issue-flow doctor --json`, `skills-manager check` y `claude-repo-guard doctor --json`. Además revisa que las skills del flujo estén en la tag de su CLI, que `.claude/cloud.json` fije una versión exacta y, en macOS, `weakerNetworkIsolation`. En un repo con `package.json`, también la línea de `AGENTS.md` y, si hay `CLAUDE.md`, su `@AGENTS.md`. Lo que no está instalado o tiene una versión nueva solo se anota con `·`. Sale con 1 si algo falla (`✗`).

## Sumar una pieza

Una pieza es un archivo en `src/pieces/` con dos funciones asíncronas: `status(root)` dice qué tiene el repo y qué pasos ofrece, y `checks(root)` da sus revisiones para `doctor`. Un paso dice qué paquetes descargar antes (`downloads`) y nunca pregunta nada: las preguntas van antes, en `src/menu.ts`. Se registra en `PIECES` de `src/commands/sync.ts` y en `src/commands/doctor.ts`. Cada paso corre la herramienta de la pieza, que es dueña de sus archivos. Un catálogo de skills nuevo es una línea en `GENERAL_CATALOGS` de `src/piece.ts`.

## Desarrollo

```sh
npm install
npm test        # compila y corre los tests
```

Los tests corren el CLI compilado sobre repos reales. `npx` y `npm` son falsos (`test/fake-tools.mjs`) y registran cada llamada. Las tags de GitHub salen de repos locales a los que git llega reescribiendo `https://github.com/`, así que `git ls-remote` es el real. Los menús no se prueban renderizados: se prueban `menuOptions` y `skillOptions`, y se corrieron en una terminal con `expect`. Con `@clack/prompts` 1.8.1, una ruedita mostrada antes de una pregunta deja a la segunda pregunta sin teclado; por eso la revisión inicial es una línea de texto.

## Publicar una versión

Una versión es una release `vX.Y.Z` en GitHub, con el mismo número que `package.json`. Al publicarla, GitHub Actions corre los tests y publica en npm con procedencia (`.github/workflows/publish.yml`).

La primera versión va a mano, porque npm solo deja configurar la publicación desde GitHub en un paquete que ya existe:

1. `npm login` y, desde `main`, `npm publish --provenance=false`.
2. En npmjs.com, en el paquete, Settings → Trusted publishing: GitHub Actions, repo `ramon-sg/agent-kitchen`, workflow `publish.yml`.
3. Pushear la tag de esa versión sin crear una release: una release volvería a publicar la misma versión y fallaría.

## Licencia

MIT
