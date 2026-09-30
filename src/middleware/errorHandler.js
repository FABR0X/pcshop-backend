/**
 * Terminal 404: any path that reached the end of the router without matching a
 * route. Registered with app.use() rather than app.get("*") because Express 5
 * dropped the bare-wildcard string form.
 */
function notFound(req, res) {
    res.status(404).json({ error: `No route for ${req.method} ${req.originalUrl}` });
}

/**
 * Central error handler. Express 5 forwards rejected promises from async
 * handlers here automatically, so a throw in a route needs no try/catch.
 * Only the message is exposed: stack traces stay in the container logs.
 */
// eslint-disable-next-line no-unused-vars -- Express identifies handlers by arity (4 args)
function errorHandler(err, req, res, next) {
    const isBadRequest = err.type === "entity.parse.failed";
    const status = err.status || (isBadRequest ? 400 : 500);

    if (status >= 500) {
        console.error(`[error] ${req.method} ${req.originalUrl}:`, err);
    }

    res.status(status).json({
        error: status >= 500 ? "Internal server error" : err.message,
        code: err.code || "INTERNAL_ERROR",
    });
}

module.exports = { notFound, errorHandler };
