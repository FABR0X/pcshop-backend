const express = require("express");
const { query } = require("../db/pool");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// Every route in this file sits behind the JWT check. Mounting the middleware on
// the router is the fail-closed default: a new route added here is protected
// unless someone explicitly opts out.
router.use(requireAuth);

const CATEGORIES = [
    "case",
    "motherboard",
    "cpu",
    "ram",
    "gpu",
    "storage",
    "psu",
    "cooling",
    "peripheral",
];

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity
function validateProduct(body) {
    const errors = [];
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const category = typeof body.category === "string" ? body.category.trim() : "";
    const brand = typeof body.brand === "string" ? body.brand.trim() : "";
    const priceRaw = body.price === "" || body.price == null ? null : Number(body.price);

    if (!name) errors.push({ field: "name", message: "Name is required" });
    else if (name.length > 120) errors.push({ field: "name", message: "Name must be 120 characters or fewer" });

    if (!CATEGORIES.includes(category)) {
        errors.push({ field: "category", message: `Category must be one of: ${CATEGORIES.join(", ")}` });
    }
    if (brand.length > 60) errors.push({ field: "brand", message: "Brand must be 60 characters or fewer" });
    if (priceRaw !== null && (!Number.isFinite(priceRaw) || priceRaw < 0)) {
        errors.push({ field: "price", message: "Price must be zero or a positive number" });
    }

    const stockRaw = body.stock === "" || body.stock == null ? 0 : Number(body.stock);
    if (!Number.isInteger(stockRaw) || stockRaw < 0) {
        errors.push({ field: "stock", message: "Stock must be zero or a positive whole number" });
    }

    if (errors.length > 0) return { errors };

    let specs = null;
    if (body.specs != null && body.specs !== "") {
        if (typeof body.specs === "object") {
            specs = body.specs;
        } else {
            // The form posts specs as a textarea of `key: value` lines, which is
            // friendlier than asking the user to type JSON. Split on the FIRST
            // colon only, so values like "4.2GHz" or "M.2" survive intact.
            specs = Object.fromEntries(
                String(body.specs)
                    .split("\n")
                    .map((line) => {
                        const at = line.indexOf(":");
                        return at === -1 ? null : [line.slice(0, at).trim(), line.slice(at + 1).trim()];
                    })
                    .filter((pair) => pair && pair[0] && pair[1])
            );
        }
    }

    return {
        product: {
            name,
            category,
            brand: brand || null,
            price: priceRaw,
            stock: stockRaw,
            specs,
        },
    };
}

/**
 * GET /api/products — the dashboard listing.
 * Optional ?category= and ?q= filters (?q= matches name or brand, case-insensitive).
 */
router.get("/", async (req, res) => {
    const category = typeof req.query.category === "string" ? req.query.category.trim() : "";
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";

    const where = [];
    const params = [];

    if (category && category !== "all") {
        if (!CATEGORIES.includes(category)) {
            return res.status(400).json({
                error: `Unknown category "${category}"`,
                code: "INVALID_CATEGORY",
                allowed: CATEGORIES,
            });
        }
        params.push(category);
        where.push(`category = $${params.length}`);
    }

    if (q) {
        params.push(`%${q}%`);
        where.push(`(name ILIKE $${params.length} OR COALESCE(brand,'') ILIKE $${params.length})`);
    }

    const sql = `
        SELECT id, name, category, brand, price, specs, stock, created_by, created_at
        FROM products
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY created_at DESC, id DESC
    `;

    const { rows } = await query(sql, params);
    res.json({ products: rows, count: rows.length });
});

/** GET /api/products/:id */
router.get("/:id", async (req, res) => {
    const { rows } = await query(
        `SELECT id, name, category, brand, price, specs, stock, created_by, created_at
         FROM products WHERE id = $1`,
        [Number(req.params.id)]
    );

    if (rows.length === 0) {
        return res.status(404).json({ error: "Product not found", code: "NOT_FOUND" });
    }
    res.json({ product: rows[0] });
});

/**
 * POST /api/products — create.
 * `created_by` comes from the verified JWT subject, not from the body, so a
 * client cannot attribute a row to somebody else.
 */
router.post("/", async (req, res) => {
    const { errors, product } = validateProduct(req.body || {});
    if (errors) {
        return res.status(422).json({ error: "Validation failed", code: "VALIDATION_ERROR", errors });
    }

    const { rows } = await query(
        `INSERT INTO products (name, category, brand, price, specs, stock, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, name, category, brand, price, specs, stock, created_by, created_at`,
        [
            product.name,
            product.category,
            product.brand,
            product.price,
            product.specs,
            product.stock,
            req.auth.handle,
        ]
    );

    console.log(`[products] created #${rows[0].id} "${rows[0].name}" by sub=${req.auth.handle}`);
    res.status(201).json({ product: rows[0] });
});

/** DELETE /api/products/:id */
router.delete("/:id", async (req, res) => {
    const { rowCount } = await query(`DELETE FROM products WHERE id = $1`, [Number(req.params.id)]);

    if (rowCount === 0) {
        return res.status(404).json({ error: "Product not found", code: "NOT_FOUND" });
    }
    res.status(204).end();
});

module.exports = { router, CATEGORIES };
