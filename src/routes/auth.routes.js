const express = require("express");
const { signToken, requireAuth } = require("../middleware/auth");
const { findUser, authenticate, describeLdapError } = require("../middleware/ldapAuth");

const router = express.Router();

/**
 * POST /api/auth/login — the only public endpoint.
 *
 * 1. The service account looks the handle up so an unknown user can be reported
 *    as such instead of collapsing into "wrong password".
 * 2. A direct bind with the submitted password verifies it against LDAP.
 * 3. On success the server signs the JWT. It is the only issuer of tokens.
 */
router.post("/login", async (req, res) => {
    const body = req.body || {};
    const handle = String(body.username || "").trim().toLowerCase();
    const password = String(body.password || "");

    if (!handle || !password) {
        return res.status(400).json({
            error: "username and password are required",
            code: "MISSING_CREDENTIALS",
        });
    }

    let user;
    try {
        user = await findUser(handle);

        if (!user) {
            console.log(`[login] rejected: unknown user "${handle}"`);
            return res.status(401).json({ error: "Unknown username", code: "USER_NOT_FOUND" });
        }

        // Bind against the DN the directory just gave us, not one rebuilt from
        // the submitted handle.
        const ok = await authenticate(user, password);
        if (!ok) {
            console.log(`[login] rejected: bad password for "${handle}"`);
            return res.status(401).json({ error: "Incorrect password", code: "BAD_PASSWORD" });
        }
    } catch (err) {
        console.error("[login] LDAP failure:", describeLdapError(err));
        return res.status(502).json({
            error: "LDAP unavailable: " + describeLdapError(err),
            code: "LDAP_UNAVAILABLE",
        });
    }

    const token = signToken({ handle: user.handle, displayName: user.displayName });
    console.log(`[login] issued JWT for "${user.handle}"`);

    res.json({
        token,
        user: { handle: user.handle, displayName: user.displayName },
    });
});

/**
 * GET /api/auth/me — echoes the verified claims. The frontend calls it on boot
 * to find out whether the token still in localStorage is worth keeping.
 */
router.get("/me", requireAuth, (req, res) => {
    res.json({ user: req.auth });
});

module.exports = router;
