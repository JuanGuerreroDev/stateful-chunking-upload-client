# Guía de contribución y operación

Este documento fija las **reglas de higiene y de trabajo** del repositorio del SDK
`@juanoecr/stateful-chunking-upload-client`. Su objetivo doble: **no ensuciar la
operación** y **proteger el SDK** (el repositorio es público; solo debe contener el
paquete, nunca la maquinaria local que lo produce).

## Gestor de paquetes

Este proyecto usa **pnpm** exclusivamente. No usar `npm` ni `yarn`. El lockfile
`pnpm-lock.yaml` se versiona.

La política de instalación y publicación vive en `.npmrc` (paquete con scope público,
versiones exactas, `engine-strict`). Ese archivo **se versiona porque solo contiene
política, nunca secretos**. El *token* de publicación **jamás** va ahí: se guarda en el
`~/.npmrc` del usuario o en la variable `NPM_TOKEN` de CI. Un `_authToken` dentro del
`.npmrc` del repositorio sería una fuga de credenciales. La atestación de procedencia
(*provenance*) tampoco se declara en `.npmrc`: se pasa como `--provenance` en el paso de
publicación de CI (requiere OIDC).

## Higiene del repositorio

### Qué **NO** se versiona (ignorado en `.gitignore`)

- **Maquinaria de Claude / AI-DLC**: `.claude/`, `CLAUDE.md`, `CLAUDE.local.md`,
  `aidlc-docs/`. Es soporte local de desarrollo, no parte del producto, y no debe
  aparecer en el repositorio público.
- **Configuraciones MCP** de cualquier IDE (`.mcp.json` y equivalentes): pueden
  contener credenciales o *tokens* de acceso personal.
- **Entorno y secretos**: `.env`, `.env.*` (salvo `.env.example`).
- **Artefactos de build y dependencias**: `node_modules/`, `dist/`, `build/`,
  `coverage/`, `*.tsbuildinfo`.

> Nunca forzar la inclusión de lo anterior con `git add -f`. Si algo de esto llega
> a *staging*, es un error de higiene: retirarlo antes de commitear.

### Qué **SÍ** se versiona

El código fuente (`src/`), pruebas (`tests/`), `package.json`, `pnpm-lock.yaml`,
configuración de TypeScript/build, `README.md`, `LICENSE`, este `CONTRIBUTING.md`,
`.gitignore`, `.gitattributes` y `.npmrc` (política de pnpm, sin secretos).

> La superficie que se publica en **npm** se controla aparte, con el campo `files`
> de `package.json` (o `.npmignore`) cuando se configure el empaquetado. `.gitignore`
> gobierna el repositorio; no el *tarball* de npm.

## Fines de línea

`.gitattributes` almacena **LF** en el repositorio y evita el *churn* CRLF/LF. En
Windows no hace falta configuración extra: el *checkout* respeta lo declarado.

## Convención de ramas (marco AI-DLC)

- **Rama base**: `main`. A `main` solo llega trabajo revisado.
- **Ramas de intent**: `aidlc/intent/<slug>`, creadas con
  `aidlc-kit intent create <nombre>`.
- **Ramas de bolt** (construcción paralela): `aidlc/intent/<slug>--bolt-<id>`,
  creadas con `aidlc-kit bolt branch <id>` y reintegradas con `aidlc-kit bolt merge`.

Las ramas de trabajo AI-DLC son **locales por defecto**: sirven para orquestar la
construcción, no para publicar la metodología. Al remoto se empuja `main` (y, cuando
aplique, ramas de *pull request* ya limpias).

## Commits

- **Conventional Commits** (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`…).
- Sin líneas de co-autoría de herramientas de IA en los mensajes de commit ni en los
  *pull requests*.
