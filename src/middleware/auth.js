const jwt = require("jsonwebtoken");
const config = require("../config/env");

/**
 * Signs the access token handed to the browser after a successful LDAP bind.
 * `subject` becomes the `sub` claim and is the only source of identity the API
 * trusts afterwards, so routes never read a user id from the request body.
 */
function signToken({ handle, displayName }) {
    return jwt.sign(
        { displayName, roles: ["user"] },
        config.jwt.secret,
        {
            subject: handle,
            expiresIn: config.jwt.expiresIn,
            issuer: config.jwt.issuer,
            audience: config.jwt.audience,
            algorithm: "HS256",
        }
    );
}

/**
 * Express middleware that requires `Authorization: Bearer <jwt>` and verifies
 * the signature, expiry, issuer and audience before the route runs.
 *
 * The `algorithms` whitelist is not optional: without it a token whose header
 * says `alg: none` (or an RS/HS confusion) would be handed to the verifier
 * instead of being rejected up front.
 */
function requireAuth(req, res, next) {
    const header = req.get("authorization") || "";
    const [scheme, token] = header.split(" ");

    if (!token || scheme.toLowerCase() !== "bearer") {
        return res.status(401).json({
            error: "Missing or malformed Authorization header",
            code: "NO_BEARER_TOKEN",
            hint: "Send 'Authorization: Bearer <jwt>'",
        });
    }

    try {
        const claims = jwt.verify(token, config.jwt.secret, {
            algorithms: ["HS256"],
            issuer: config.jwt.issuer,
            audience: config.jwt.audience,
        });

        // Expose the verified identity for downstream handlers. Never read the
        // user from anywhere else.
        req.auth = {
            handle: claims.sub,
            displayName: claims.displayName,
            roles: claims.roles || [],
            issuedAt: claims.iat,
            expiresAt: claims.exp,
        };

        console.log(
            `🔐 [auth] Bearer verified → sub=${claims.sub} ` +
                `exp=${new Date(claims.exp * 1000).toISOString()} ` +
                `for ${req.method} ${req.originalUrl}`
        );

        return next();
    } catch (err) {
        const expired = err.name === "TokenExpiredError";
        console.warn(`🔐 [auth] Bearer rejected (${err.name}) for ${req.method} ${req.originalUrl}`);

        return res.status(401).json({
            error: expired ? "Token expired" : "Invalid token",
            code: expired ? "TOKEN_EXPIRED" : "TOKEN_INVALID",
        });
    }
}

module.exports = { requireAuth, signToken };
