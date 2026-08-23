# SQLite storage boundary

The WhatsApp gateway stores only operational conversation workflow state, encrypted transcript bodies, pseudonymous customer references, escalation state and audit evidence.

Runtime database path: set `DATABASE_URL=/data/simpli-whatsapp.sqlite` until the environment variable is renamed in a later compatibility release. The value is a filesystem path, not a PostgreSQL URL.

A persistent Railway volume must be mounted at `/data` before deployment. Product, price, stock, payment, order, customer-profile and consent truth remain outside this store and must be retrieved from their governing Simpli systems.
