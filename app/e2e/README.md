# End-to-end tests

Starquix is a desktop (Electron) app. Its end-to-end suite lives in
`desktop/e2e` and drives the real app (editor + local project server):

```sh
npm ci --prefix desktop
npm run deps --prefix desktop
npm run test:e2e --workspace=app   # = npm --prefix ../desktop run test:electron
```

The browser WebContainer release suite (`e2e/release`, `e2e/performance`) was
removed with the WebContainer runtime (2026-10-07). `e2e/fixtures/release-project`
is still the desktop suite's fixture project.

`npm run test:e2e:legacy` runs the retired API-mock specs in this folder.
