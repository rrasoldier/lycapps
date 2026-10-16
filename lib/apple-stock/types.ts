export type AvailabilityStatus = "available" | "unavailable" | "not-yet";

export interface PartAvailability {
  partNumber: string;
  title: string;
  status: AvailabilityStatus;
  /** Apple's own wording, e.g. "Disponible Demain" or "Revenez vérifier la disponibilité le 24/10". */
  quote: string;
}

export interface StoreAvailability {
  storeNumber: string;
  name: string;
  city: string;
  address: string;
  postalCode: string;
  distance: string;
  url: string;
  imageUrl: string;
  phone: string;
  latitude: number;
  longitude: number;
  parts: PartAvailability[];
}

export interface StockResponse {
  country: string;
  location: string;
  fetchedAt: string;
  cached: boolean;
  /** Seconds before the server will query Apple again for this exact request. */
  nextRefreshIn: number;
  stores: StoreAvailability[];
  /** Region queries only: expected stores Apple did not return. */
  missingStores?: string[];
}

export interface StockError {
  error: string;
  retryAfter?: number;
}
