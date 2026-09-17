# v3 foundation PR summary

## Purpose

Establish a Novamira-free first-party Simpli MCP foundation without changing production.

## This tranche changes

- canonical release identity;
- version/readiness observability;
- architecture/security/acceptance documentation;
- regression tests preventing Novamira runtime endpoint/package dependencies;
- safe continuation and verification records.

## This tranche does not change

- production deployment;
- live WordPress configuration;
- Novamira plugin state;
- OAuth credential format;
- MCP SDK major version;
- capability write authority;
- DNS or hosting configuration.

## Merge condition

Do not merge until CI passes and the diff is reviewed. Merge itself is not production deployment approval.
