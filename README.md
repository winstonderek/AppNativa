# AppNativa

Repository for the **Pynn** native desktop client.

## Pynn Desktop

The Electron desktop application lives in [`electron/`](electron/). It loads the production web app at https://angelhive.pynn.ai without modifying the web codebase.

```bash
cd electron
npm install
npm start
```

See [electron/README.md](electron/README.md) for full documentation on packaging, code signing, auto-update, and CI.
