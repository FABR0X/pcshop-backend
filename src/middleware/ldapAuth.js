const ldap = require("ldapjs");
const config = require("../config/env");

/**
 * Opens a connection to the directory. Resolves once the socket is up so the
 * caller never binds against a half-open client.
 */
function connect() {
    return new Promise((resolve, reject) => {
        const client = ldap.createClient({ url: config.ldap.url, timeout: 5000, connectTimeout: 5000 });
        const onError = (err) => reject(err);
        const onConnect = () => {
            client.removeListener("error", onError);
            // After a successful connect an eventual socket error must not become
            // an unhandled 'error' event; the in-flight request handles it.
            client.on("error", () => {});
            resolve(client);
        };
        client.once("error", onError);
        client.on("connect", onConnect);
    });
}

function bind(client, dn, password) {
    return new Promise((resolve, reject) => {
        client.bind(dn, password, (err) => {
            if (err) return reject(err);
            resolve();
        });
    });
}

/**
 * Flattens one SearchResultEntry into a plain object.
 *
 * ldapjs 3 exposes attributes as a raw array of `{ type, values }` pairs under
 * `pojo`, and no longer provides the flat `object` property that older examples
 * read. Attribute values are always arrays, so the first one is taken.
 *
 * Normalising here means nothing above this function depends on the shape of an
 * ldapjs response, and the directory's own spelling of the DN is carried through
 * untouched.
 */
function toPlainEntry(entry) {
    const pojo = entry.pojo ?? entry.object ?? {};
    const flat = {};

    for (const attribute of pojo.attributes ?? []) {
        if (Array.isArray(attribute?.values) && attribute.values.length > 0) {
            flat[attribute.type] = attribute.values[0];
        }
    }

    return { ...flat, dn: pojo.objectName };
}

function search(client, base, options) {
    return new Promise((resolve, reject) => {
        client.search(base, options, (searchErr, res) => {
            if (searchErr) return reject(searchErr);

            const entries = [];
            res.on("searchEntry", (entry) => entries.push(toPlainEntry(entry)));
            res.on("error", reject);
            res.on("end", () => resolve(entries));
        });
    });
}

/**
 * Escapes the RFC 4515 metacharacters so a handle typed in the login form
 * cannot break out of the search filter (LDAP injection).
 *
 * RFC 4515 covers `*`, `(`, `)`, `\` and NUL. Note this is a *filter* escape and
 * must not be used to build a DN: the two grammars escape different characters,
 * and a comma or a plus sign is harmless in a filter but would change the
 * structure of a distinguished name.
 */
function escapeFilter(value) {
    return String(value).replace(/[\\*()\u0000]/g, (c) => `\\${c.charCodeAt(0).toString(16).padStart(2, "0")}`);
}

/**
 * Looks the user up as the service account. Used to tell "unknown username"
 * apart from "wrong password", which LDAP's bind alone cannot do (both surface
 * as invalid credentials).
 */
async function findUser(handle) {
    const client = await connect();
    try {
        await bind(client, config.ldap.svcDn, config.ldap.svcPassword);
        const entries = await search(client, config.ldap.peopleOu, {
            scope: "sub",
            filter: `(&(objectClass=inetOrgPerson)(cn=${escapeFilter(handle)}))`,
            attributes: ["cn", "uid", "displayName"],
        });

        if (entries.length === 0) return null;

        const entry = entries[0];
        // Not named `handle`: that is the parameter this function was given, and
        // a const in the same scope would shadow it into a temporal dead zone.
        const resolved = entry.uid || entry.cn;

        // A match with no cn is not something the rest of the code can use as
        // an identity, so treat it as not found rather than issuing a token for
        // an empty subject.
        if (!resolved || !entry.dn) return null;

        return {
            handle: resolved,
            displayName: entry.displayName || resolved,
            // The directory's own DN, verbatim. Nothing here reconstructs it.
            dn: entry.dn,
        };
    } finally {
        client.unbind(() => {});
    }
}

/**
 * Verifies the password against the directory with a direct bind: the value
 * typed in the login form is checked against the user's own DN. Nothing is
 * stored and no hash is compared in Node — LDAP answers.
 *
 * Takes the DN that findUser() already resolved rather than rebuilding one from
 * the submitted handle. The directory is the only authority on how a DN is
 * spelled, and a DN assembled from user input would need RFC 4515 escaping that
 * is different from the filter escaping above.
 *
 * Infrastructure failures (a refused connection, a hidden entry) propagate so
 * the caller can tell them apart from a genuinely wrong password; only error
 * 49 is reported here as an authentication failure.
 */
async function authenticate(user, password) {
    const client = await connect();
    try {
        await bind(client, user.dn, password);
        return true;
    } catch (err) {
        if (err && err.code === 49) return false;
        throw err;
    } finally {
        client.unbind(() => {});
    }
}

/** Turns an LDAP error into a message safe to log (never echoes credentials). */
function describeLdapError(err) {
    if (!err) return "LDAP error";
    if (err.code === 49) return "invalid credentials";
    if (err.code === 32) return "no such object";
    if (err.code === 50) return "insufficient access rights";
    return `${err.name || "LDAPError"}: ${err.message || "unknown error"}`;
}

module.exports = { findUser, authenticate, describeLdapError };
