# Lulu Speedworks

Lulu Speedworks is a store for physical RC products, with Lulu as its brand mascot.

The [storefront specification](storefront-spec.md) is the canonical implementation brief: confirmed requirements, published API mappings, A2UI/AG-UI responsibilities, acceptance criteria, milestones, and integration gates. Existing decision notes remain supporting history.

## Initial design prototype

The requested three-direction A2UI/shadcn prototype is in `/home/ben/projects/luluspeedworks-prototype`, on throwaway branch `prototype/initial-design`. Run `pnpm prototype` there and open `http://localhost:5190/prototype/storefront`. The user selected **B — Pit Bench** on 2026-09-20; B is the default, with A/C retained for reference. Its README and `docs/interface-designs.md` record the selection. Production implementation remains pending. The existing API and store repositories remain reference sources.

## Language

**Catalog Item**:
A physical product offered for purchase in the curated store catalog.
_Avoid_: Digital download, print file

**On-Demand Order**:
An order for physical catalog items made after purchase and shipped to the customer.
_Avoid_: File purchase

**Lulu**:
The dog represented in the Lulu Speedworks brand logo and the brand's mascot.
_Avoid_: Product category

**RC Parts**:
The catalog category for physical components and accessories used on RC vehicles.
_Avoid_: Pit tools

**Pit Tools**:
The catalog category for physical tools and aids used to prepare, maintain, or organize RC vehicles and equipment.
_Avoid_: Vehicle components
