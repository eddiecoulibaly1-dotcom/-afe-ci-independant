import type { MarketProductCategory } from "./market-intelligence.js";

/**
 * Supplier directory for chick-price research.
 * Roles describe the activity evidenced by public sources, not a guarantee
 * that a supplier currently sells day-old chicks directly.
 */
export interface ChickSupplierDirectoryEntry {
  id: string;
  name: string;
  publicUrl: string;
  role: "hatchery_or_chick_supplier" | "animal_feed_supplier" | "needs_direct_confirmation";
  status: "priority_contact" | "verify_chick_sales" | "reference_only";
  notes: string;
  categories: MarketProductCategory[];
}

export const CHICK_PRICE_SUPPLIERS: ChickSupplierDirectoryEntry[] = [
  {
    id: "ivoire-poussins",
    name: "Ivoire Poussins / SIPRA",
    publicUrl: "https://groupeavos.ci/",
    role: "hatchery_or_chick_supplier",
    status: "priority_contact",
    notes: "Fournisseur prioritaire à solliciter pour les tarifs, souches, vaccinations, quantités minimales et disponibilités. Aucun tarif public actuel vérifié.",
    categories: ["chick"]
  },
  {
    id: "ivograin",
    name: "Ivograin / AVOS",
    publicUrl: "https://groupeavos.ci/",
    role: "animal_feed_supplier",
    status: "verify_chick_sales",
    notes: "Activité publique principalement associée à la nutrition animale. Vérifier explicitement si Ivograin vend directement des poussins ou peut orienter vers le couvoir/distributeur compétent.",
    categories: ["feed", "chick"]
  },
  {
    id: "koudijs-poussin-dor",
    name: "Koudijs / Poussin d'Or",
    publicUrl: "https://poussinsdor.ci/",
    role: "hatchery_or_chick_supplier",
    status: "priority_contact",
    notes: "Piste prioritaire pour les poussins de chair et de ponte ; tarif, souche, vaccination, disponibilité et conditions de livraison à confirmer directement.",
    categories: ["chick"]
  }
];

export const CHICK_QUOTATION_FIELDS = [
  "product", "strain", "value", "currency", "unit", "minimumQuantity",
  "packSize", "vaccinationStatus", "availabilityDate", "city", "deliveryFee",
  "sourceName", "sourceUrl", "publishedAt", "observedAt", "validUntil"
] as const;
