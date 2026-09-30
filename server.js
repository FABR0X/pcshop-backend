const express = require("express");
const helmet = require("helmet");
const cors = require("cors");

const config = require("./src/config/env");
const { query } = require("./src/db/pool");
const { requireAuth } = require("./src/middleware/auth");
const { requestLogger } = require("./src/middleware/requestLogger");
const { notFound, errorHandler } = require("./src/middleware/errorHandler");
const authRoutes = require("./src/routes/auth.routes");
const { router: productsRouter, CATEGORIES } = require("./src/routes/products.routes");

const app = express();

app.disable("x-powered-by");
app.use(helmet());
// The production path is same-origin: nginx serves the SPA and reverse-proxies
// /api to this process, so CORS is only needed for `npm run dev` against the
// Vite dev server on a different port.
app.use(cors({ origin: true, credentials: false }));
app.use(express.json({ limit: "32kb" }));
app.use(requestLogger);

/** Unauthenticated liveness probe used by the compose healthcheck. */
app.get("/health", async (req, res) => {
    try {
        await query("SELECT 1");
        res.json({ ok: true, database: "up" });
    } catch (err) {
        console.error("[health] database unreachable:", err.message);
        res.status(503).json({ ok: false, database: "down" });
    }
});

// The category vocabulary is data, not a route: the form needs it to render.
app.get("/api/categories", requireAuth, (req, res) => {
    res.json({ categories: CATEGORIES });
});

app.use("/api/auth", authRoutes);
app.use("/api/products", productsRouter);

app.use(notFound);
app.use(errorHandler);

const server = app.listen(config.port, () => {
    console.log(`pcshop-backend listening on :${config.port} (${config.isProduction ? "production" : "development"})`);
    console.log(`  JWT issuer   ${config.jwt.issuer}`);
    console.log(`  JWT expires  ${config.jwt.expiresIn}`);
    console.log(`  LDAP         ${config.ldap.url}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
        console.log(`\n[shutdown] ${signal} received, closing server`);
        server.close(async () => {
            const { close } = require("./src/db/pool");
            await close();
            process.exit(0);
        });
    });
}

module.exports = app;
