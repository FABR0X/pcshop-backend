require("dotenv").config();

/**
 * Reads an environment variable and fails fast when it is missing. Called only
 * for values the process genuinely cannot boot without, so a misconfigured
 * container surfaces the problem immediately instead of throwing 401s later.
 */
function required(name, fallback) {
    const value = process.env[name] ?? fallback;
    if (value === undefined || value === "") {
        throw new Error(
            `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`
        );
    }
    return value;
}

const isProduction = process.env.NODE_ENV === "production";

const config = {
    port: Number(process.env.PORT || 3000),
    isProduction,

    database: {
        url: required("DATABASE_URL", "postgres://postgres:abc123@localhost:5432/pcshop"),
    },

    jwt: {
        secret: required("JWT_SECRET"),
        expiresIn: process.env.JWT_EXPIRES_IN || "5m",
        issuer: process.env.JWT_ISSUER || "pcshop-api",
        audience: process.env.JWT_AUDIENCE || "pcshop-frontend",
    },

    ldap: {
        url: process.env.LDAP_URL || "ldap://127.0.0.1:389",
        baseDn: process.env.LDAP_BASE_DN || "dc=lab,dc=local",
        peopleOu: process.env.LDAP_PEOPLE_OU || `ou=People,${process.env.LDAP_BASE_DN || "dc=lab,dc=local"}`,
        svcDn: process.env.LDAP_SVC_DN || "cn=svc-pcshop,ou=Services,dc=lab,dc=local",
        svcPassword: required("LDAP_SVC_PASSWORD", "SvcPcshop-@2026"),
    },
};

// A short/guessable signing secret silently turns the whole exercise into a
// forgeable-token demo, so refuse to boot on the obvious placeholders.
if (config.jwt.secret.length < 32 || config.jwt.secret.startsWith("change-me")) {
    throw new Error(
        "JWT_SECRET must be at least 32 characters and not a placeholder. " +
            'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"'
    );
}

module.exports = config;
