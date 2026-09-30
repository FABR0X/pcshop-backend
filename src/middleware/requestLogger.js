/**
 * Logs one line per request. Mounted before the auth middleware so a rejected
 * call is still visible — for the demo video this is the server-side half of
 * "the JWT travelled with the request and the server read it".
 */
function requestLogger(req, res, next) {
    const startedAt = process.hrtime.bigint();

    res.on("finish", () => {
        const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
        const who = req.auth ? `sub=${req.auth.handle}` : "anonymous";
        console.log(
            `${req.method} ${req.originalUrl} → ${res.statusCode} (${who}, ${ms.toFixed(1)}ms)`
        );
    });

    next();
}

module.exports = { requestLogger };
