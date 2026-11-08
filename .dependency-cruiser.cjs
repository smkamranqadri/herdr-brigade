// Import rules between layers (guide A1). Dependencies point inward: entrypoints > adapters > application > domain.
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "domain-is-pure",
      comment: "domain imports only domain: no other layer and no Node module (no I/O).",
      severity: "error",
      from: { path: "^src/domain/", pathNot: "\\.test\\.ts$" },
      to: { pathNot: "^src/domain/" },
    },
    {
      name: "application-imports-inward",
      comment: "application imports only domain and application, and no Node module.",
      severity: "error",
      from: { path: "^src/application/", pathNot: "\\.test\\.ts$" },
      to: { pathNot: "^src/(domain|application)/" },
    },
    {
      name: "adapters-not-entrypoints",
      severity: "error",
      from: { path: "^src/adapters/" },
      to: { path: "^src/entrypoints/" },
    },
    {
      name: "adapters-independent",
      comment: "One adapter package never imports another.",
      severity: "error",
      from: { path: "^src/adapters/([^/]+)/" },
      to: { path: "^src/adapters/", pathNot: "^src/adapters/$1/" },
    },
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
  },
};
