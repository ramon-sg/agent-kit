# agent-kit

Un solo comando para instalar, actualizar y revisar lo que un repo usa para trabajar con agentes: el flujo de issues con sus skills, las skills generales, las sesiones de Claude en la nube y las barandas de seguridad.

```sh
npx @ramon-sg/agent-kit@latest          # muestra qué hay, qué falta y qué está atrasado, y pregunta
npx @ramon-sg/agent-kit@latest doctor   # revisa que todo funcione, sin cambiar nada
```

El paquete es `@ramon-sg/agent-kit` y el comando, `agent-kit`. El `@latest` hace que `npx` no use una copia vieja guardada en su caché.

## En simple

- Muestra cada pieza con la versión que tiene el repo y la última que existe.
- Ofrece instalar lo que falta y actualizar lo que está atrasado, en un menú de casillas. Todo viene marcado; desmarcas lo que no quieres.
- Cada pieza la instala su propia herramienta. `agent-kit` solo sabe cuáles hay, en qué versión están y cómo se conectan entre sí.
- Correrlo de nuevo no rompe nada: si todo está al día, lo dice y termina.

## Las piezas

| Pieza | Qué es | Versión del repo | Última | Instalar | Actualizar |
|---|---|---|---|---|---|
| `issue-flow` | Flujo de issues ([`@ramon-sg/issue-flow`](https://github.com/ramon-sg/issue-flow)): rama, worktree y PR en draft por issue, y sus 5 skills | `package.json` | npm | `issue-flow init` | `issue-flow upgrade` en la versión nueva, y sus skills a la misma tag |
| `claude-cloud` | Sesiones en la nube ([`@ramon-sg/claude-cloud`](https://github.com/ramon-sg/claude-cloud)): herramientas, Docker y el clone completo | `.claude/cloud.json` | npm | `claude-cloud init` | Cambia la versión que fija `.claude/cloud.json` |
| `claude-repo-guard` | Barandas ([`claude-repo-guard`](https://github.com/ramon-sg/claude-repo-guard)): modo auto con sandbox, escribe solo en su worktree | `.claude/repo-guard.manifest.json` | Tags `vX.Y.Z` de GitHub | `install` en esa tag | `install` en la tag nueva |
| `skills` | Skills con [`skills-manager`](https://github.com/ramon-sg/skills-manager): las del flujo y las de [`agent-skills`](https://github.com/ramon-sg/agent-skills) (planes, auditoría de código y de tests) | `.agents/skills.lock.json` | Tags del catálogo | El menú de `skills-manager` | `skills-manager update` |

Si npm o GitHub no responden, la pieza se muestra pero no se ofrece actualizarla. Si un paso falla, los demás siguen y el comando dice cómo reintentarlo.

### Cómo se conectan

- **Las skills del flujo van con su CLI,** porque la llaman: se instalan en la tag de la versión del flujo y se mueven con él. Las generales llevan cada una su propia versión.
- **Skills nuevas:** si un catálogo trae skills que el repo no tiene, aparecen en el menú sin marcar. Al marcarlas se abre el menú de `skills-manager` para elegir.
- **Seguridad y flujo:** si el repo tiene el flujo, antes de instalar `claude-repo-guard` se escribe en sus opciones que abrir el PR en draft, asignar la issue y agregar el "Slug de rama" son parte del trabajo normal. También se escribe la rama base del flujo como `integrationBranch`. En macOS se agrega `weakerNetworkIsolation`, que `gh` necesita dentro del sandbox. Si `claude-repo-guard` ya estaba al día pero le faltan esas opciones, se ofrecen como un paso.
- **La nube no molesta en local:** el hook de sesión solo actúa en la nube. Un repo que nunca se abre ahí no pierde nada.

## Uso

```sh
npx @ramon-sg/agent-kit@latest                        # menú, en una terminal
npx @ramon-sg/agent-kit@latest --dry-run              # solo muestra qué ofrecería
npx @ramon-sg/agent-kit@latest --yes                  # hace lo sugerido sin preguntar
npx @ramon-sg/agent-kit@latest --skip claude-cloud    # deja fuera una pieza (o varias, con comas)
npx @ramon-sg/agent-kit@latest doctor                 # revisa cada pieza con su propio doctor
```

- **Sin terminal y sin `--yes`** (por ejemplo, desde un agente), solo muestra lo que ofrecería.
- **Corre en el checkout principal,** no en un worktree, y desde tu terminal. Dentro de una sesión de Claude, el sandbox de `claude-repo-guard` no deja escribir `.claude/settings.json`.
- **Al terminar,** corre el `install` de tu gestor de paquetes, revisa el diff y haz commit.

**`doctor`** corre el doctor de cada herramienta en la versión del repo: `issue-flow doctor --json`, `skills-manager check` y `claude-repo-guard doctor --json`. Además revisa que las skills del flujo estén en la tag de su CLI, que `.claude/cloud.json` fije una versión exacta y, en macOS, `weakerNetworkIsolation`. Lo que no está instalado o tiene una versión nueva solo se anota con `·`. Sale con 1 si algo falla (`✗`).

## Sumar una pieza

Una pieza es un archivo en `src/pieces/` con dos funciones: `status(root)` dice qué tiene el repo y qué pasos ofrece, y `checks(root)` da sus revisiones para `doctor`. Se registra en `PIECES` de `src/commands/sync.ts` y en `src/commands/doctor.ts`. Cada paso corre la herramienta de la pieza, que es dueña de sus archivos. Un catálogo de skills nuevo es una línea en `GENERAL_CATALOGS` de `src/piece.ts`.

## Desarrollo

```sh
npm install
npm test        # compila y corre los tests
```

Los tests corren el CLI compilado sobre repos reales. `npx` y `npm` son falsos (`test/fake-tools.mjs`) y registran cada llamada. Las tags de GitHub salen de repos locales a los que git llega reescribiendo `https://github.com/`, así que `git ls-remote` es el real. El menú no se prueba renderizado: se prueba `menuOptions` y se corrió a mano en una terminal.

## Publicar una versión

Una versión es una release `vX.Y.Z` en GitHub, con el mismo número que `package.json`. Al publicarla, GitHub Actions corre los tests y publica en npm con procedencia (`.github/workflows/publish.yml`).

La primera versión va a mano, porque npm solo deja configurar la publicación desde GitHub en un paquete que ya existe:

1. `npm login` y, desde `main`, `npm publish --provenance=false`.
2. En npmjs.com, en el paquete, Settings → Trusted publishing: GitHub Actions, repo `ramon-sg/agent-kit`, workflow `publish.yml`.
3. Pushear la tag `v0.1.0` sin crear una release: una release volvería a publicar la misma versión y fallaría.

## Licencia

MIT
