# fx web

Angular frontend for the `fx` project. One dev server (port `4211`) serves a
home page plus five apps:

- `/` — home page, links to everything below
- `/la-lady` — Source Audio L.A. Lady inspector (talks to `back/lalady` on :3111)
- `/h90` — Eventide H90 patch explorer (proxies `/api/*` to `back/h90` on :3000)
- `/h90/starters` — H90 factory effect starters
- `/c4` — Source Audio C4 Synth workbench (talks to `back/c4` on :3222)
- `/mc3` — Morningstar MC3 backup inspector (talks to `back/mc3` on :3223)

Source layout: the L.A. Lady app is `src/app/la-lady/`, the H90 pages are
`src/app/pages/{browse,preset-detail,starters}/`, and the rest are
`src/app/{c4,mc3}/`.

## Development server

Run `npm start` (or `ng serve`) for a dev server. Navigate to `http://localhost:4211/`.

## Code scaffolding

Run `ng generate component component-name` to generate a new component. You can also use `ng generate directive|pipe|service|class|guard|interface|enum|module`.

## Build

Run `ng build` to build the project. The build artifacts will be stored in the `dist/` directory.

## Running unit tests

Run `ng test` to execute the unit tests via [Karma](https://karma-runner.github.io).

## Running end-to-end tests

Run `ng e2e` to execute the end-to-end tests via a platform of your choice. To use this command, you need to first add a package that implements end-to-end testing capabilities.

## Further help

To get more help on the Angular CLI use `ng help` or go check out the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
