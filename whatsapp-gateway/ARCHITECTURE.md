# Architecture

Customer WhatsApp -> YCloud -> signed webhook -> Simpli WhatsApp Gateway -> risk/intent gate -> governed read-only Simpli truth + AI advisor -> pre-send QA -> YCloud outbound.

Conversation ownership is explicitly AI or HUMAN. Human takeover is a send lock. SHADOW is the release default. The gateway never becomes authoritative for product, price, stock, payment, order, authenticity, regulatory status, customer preference or marketing consent.
